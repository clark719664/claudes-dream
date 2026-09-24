#include "SkyStackDirector.h"

#include "SkyStackBlock.h"
#include "SkyStackSave.h"
#include "SkySynth.h"

#include "Camera/CameraComponent.h"
#include "Components/AudioComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/InputComponent.h"
#include "Components/PostProcessComponent.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "HAL/PlatformApplicationMisc.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Misc/App.h"

namespace SkyStackTuning
{
	constexpr double BlockHeight = 36.0;
	constexpr double BaseSize = 320.0;
	constexpr double PillarDepth = 3000.0;
	constexpr double PerfectTolerance = 8.0;
	/** The perfect window also widens with speed so it stays ~28ms of timing, not a fixed distance. */
	constexpr double PerfectWindowSeconds = 0.028;
	constexpr double TravelRange = 480.0;
	constexpr double GrowAmount = 16.0;
	constexpr float BaseSpeed = 320.f;
	constexpr float SpeedPerFloor = 6.5f;
	constexpr float MaxSpeed = 900.f;
	constexpr int32 ComboToGrow = 4;
	constexpr int32 FloorsPerZone = 20;
	constexpr double ClutchRatio = 0.3;
	static const TCHAR* const SaveSlot = TEXT("SkyStack");
}

namespace
{
	/** Each zone restyles the sky and sun as the tower climbs. */
	struct FZoneInfo
	{
		const TCHAR* Name;
		FLinearColor Fog;
		FLinearColor Sun;
		float SunIntensity;
		float SunPitch;
	};

	const FZoneInfo GZones[] =
	{
		{ TEXT("GROUND FLOOR"), FLinearColor(0.45f, 0.65f, 0.90f),  FLinearColor(1.00f, 0.96f, 0.90f), 4.0f, -55.f },
		{ TEXT("CLOUD LINE"),   FLinearColor(0.75f, 0.82f, 0.95f),  FLinearColor(1.00f, 1.00f, 1.00f), 4.5f, -62.f },
		{ TEXT("GOLDEN HOUR"),  FLinearColor(0.95f, 0.55f, 0.30f),  FLinearColor(1.00f, 0.75f, 0.45f), 4.2f, -28.f },
		{ TEXT("DUSK"),         FLinearColor(0.42f, 0.20f, 0.45f),  FLinearColor(1.00f, 0.55f, 0.60f), 3.2f, -18.f },
		{ TEXT("NIGHT SKY"),    FLinearColor(0.03f, 0.05f, 0.14f),  FLinearColor(0.60f, 0.70f, 1.00f), 2.4f, -50.f },
		{ TEXT("LOW ORBIT"),    FLinearColor(0.005f, 0.005f, 0.02f), FLinearColor(1.00f, 1.00f, 1.00f), 5.0f, -40.f },
		{ TEXT("THE VOID"),     FLinearColor(0.12f, 0.00f, 0.16f),  FLinearColor(0.90f, 0.40f, 1.00f), 4.0f, -45.f },
	};
	constexpr int32 NumZones = UE_ARRAY_COUNT(GZones);

	int32 ComputeDailyId()
	{
		const FDateTime Epoch(2026, 1, 1);
		return static_cast<int32>(FMath::FloorToDouble((FDateTime::UtcNow() - Epoch).GetTotalDays())) + 1;
	}

	/** Emoji live outside the BMP, so encode them as UTF-16 surrogate pairs where TCHAR is 16-bit. */
	void AppendCodepoint(FString& Out, uint32 Codepoint)
	{
		if constexpr (sizeof(TCHAR) == 2)
		{
			if (Codepoint > 0xFFFF)
			{
				Codepoint -= 0x10000;
				Out.AppendChar(static_cast<TCHAR>(0xD800 + (Codepoint >> 10)));
				Out.AppendChar(static_cast<TCHAR>(0xDC00 + (Codepoint & 0x3FF)));
				return;
			}
		}
		Out.AppendChar(static_cast<TCHAR>(Codepoint));
	}

	FVector RandomSpin(float Max)
	{
		return FVector(FMath::FRandRange(-Max, Max), FMath::FRandRange(-Max, Max), FMath::FRandRange(-Max, Max));
	}
}

ASkyStackDirector::ASkyStackDirector()
{
	PrimaryActorTick.bCanEverTick = true;
	bUseControllerRotationPitch = false;
	bUseControllerRotationYaw = false;
	bUseControllerRotationRoll = false;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent = Root;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(Root);
	Camera->SetUsingAbsoluteLocation(true);
	Camera->SetUsingAbsoluteRotation(true);
	Camera->SetFieldOfView(50.f);
	Camera->bConstrainAspectRatio = false;

	KeyLight = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("KeyLight"));
	KeyLight->SetupAttachment(Root);
	KeyLight->SetMobility(EComponentMobility::Movable);
	KeyLight->SetUsingAbsoluteRotation(true);
	KeyLight->SetRelativeRotation(FRotator(-55.f, 200.f, 0.f));
	KeyLight->Intensity = 4.f;

	// A cool, shadowless fill from the other side gives every block the two-tone
	// "lit face / shade face" look without needing baked or global illumination.
	FillLight = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("FillLight"));
	FillLight->SetupAttachment(Root);
	FillLight->SetMobility(EComponentMobility::Movable);
	FillLight->SetUsingAbsoluteRotation(true);
	FillLight->SetRelativeRotation(FRotator(-25.f, 290.f, 0.f));
	FillLight->Intensity = 1.4f;
	FillLight->LightColor = FColor(170, 190, 255);
	FillLight->CastShadows = false;

	// The height fog doubles as the sky: everything far away melts into the zone colour.
	Fog = CreateDefaultSubobject<UExponentialHeightFogComponent>(TEXT("Fog"));
	Fog->SetupAttachment(Root);
	Fog->FogDensity = 0.06f;
	Fog->FogHeightFalloff = 0.15f;
	Fog->FogMaxOpacity = 1.f;
	Fog->StartDistance = 2000.f;

	PostFX = CreateDefaultSubobject<UPostProcessComponent>(TEXT("PostFX"));
	PostFX->SetupAttachment(Root);
	PostFX->bUnbound = true;
	FPostProcessSettings& Settings = PostFX->Settings;
	Settings.bOverride_AutoExposureMethod = true;
	Settings.AutoExposureMethod = AEM_Manual;
	Settings.bOverride_AutoExposureApplyPhysicalCameraExposure = true;
	Settings.AutoExposureApplyPhysicalCameraExposure = false;
	Settings.bOverride_AutoExposureBias = true;
	Settings.AutoExposureBias = 0.f;
	Settings.bOverride_BloomIntensity = true;
	Settings.BloomIntensity = 0.8f;
	Settings.bOverride_VignetteIntensity = true;
	Settings.VignetteIntensity = 0.45f;
	Settings.bOverride_SceneFringeIntensity = true;
	Settings.SceneFringeIntensity = 0.4f;
	Settings.bOverride_MotionBlurAmount = true;
	Settings.MotionBlurAmount = 0.f;
	Settings.bOverride_ColorSaturation = true;
	Settings.ColorSaturation = FVector4(1.1, 1.1, 1.1, 1.0);

	Audio = CreateDefaultSubobject<UAudioComponent>(TEXT("Audio"));
	Audio->SetupAttachment(Root);
	Audio->bAutoActivate = false;
	Audio->bAllowSpatialization = false;
	Audio->bIsUISound = true;
}

void ASkyStackDirector::BeginPlay()
{
	Super::BeginPlay();

	Save = Cast<USkyStackSave>(UGameplayStatics::LoadGameFromSlot(SkyStackTuning::SaveSlot, 0));
	if (!Save)
	{
		Save = Cast<USkyStackSave>(UGameplayStatics::CreateSaveGameObject(USkyStackSave::StaticClass()));
	}
	DailyId = ComputeDailyId();
	if (Save->BestDailyId != DailyId)
	{
		Save->BestDaily = 0;
		Save->BestDailyId = DailyId;
	}

	Synth = NewObject<USkySynth>(this);
	Synth->SetMuted(Save->bMuted);
	Audio->SetSound(Synth);
	Audio->Play();

	FogColor = GZones[0].Fog;
	SunColor = GZones[0].Sun;
	SunIntensity = GZones[0].SunIntensity;
	SunPitch = GZones[0].SunPitch;

	BuildEnvironment();
	EnterTitle();
	CamTarget = FVector(0.0, 0.0, RunHeight * 0.5);
}

void ASkyStackDirector::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	for (const FKey& Key : { EKeys::SpaceBar, EKeys::LeftMouseButton, EKeys::Enter, EKeys::Gamepad_FaceButton_Bottom, EKeys::Gamepad_Special_Right })
	{
		PlayerInputComponent->BindKey(Key, IE_Pressed, this, &ASkyStackDirector::OnPrimary);
	}
	PlayerInputComponent->BindTouch(IE_Pressed, this, &ASkyStackDirector::OnTouchPressed);

	PlayerInputComponent->BindKey(EKeys::R, IE_Pressed, this, &ASkyStackDirector::OnRetry);
	PlayerInputComponent->BindKey(EKeys::Gamepad_FaceButton_Left, IE_Pressed, this, &ASkyStackDirector::OnRetry);

	PlayerInputComponent->BindKey(EKeys::Escape, IE_Pressed, this, &ASkyStackDirector::OnBack);
	PlayerInputComponent->BindKey(EKeys::Tab, IE_Pressed, this, &ASkyStackDirector::OnBack);
	PlayerInputComponent->BindKey(EKeys::Gamepad_FaceButton_Right, IE_Pressed, this, &ASkyStackDirector::OnBack);

	PlayerInputComponent->BindKey(EKeys::D, IE_Pressed, this, &ASkyStackDirector::OnSelectDaily);
	PlayerInputComponent->BindKey(EKeys::E, IE_Pressed, this, &ASkyStackDirector::OnSelectEndless);
	for (const FKey& Key : { EKeys::Left, EKeys::Right, EKeys::Up, EKeys::Down, EKeys::Gamepad_DPad_Left, EKeys::Gamepad_DPad_Right })
	{
		PlayerInputComponent->BindKey(Key, IE_Pressed, this, &ASkyStackDirector::OnToggleMode);
	}

	PlayerInputComponent->BindKey(EKeys::C, IE_Pressed, this, &ASkyStackDirector::OnCopyShare);
	PlayerInputComponent->BindKey(EKeys::Gamepad_FaceButton_Top, IE_Pressed, this, &ASkyStackDirector::OnCopyShare);
	PlayerInputComponent->BindKey(EKeys::M, IE_Pressed, this, &ASkyStackDirector::OnToggleMute);
}

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

void ASkyStackDirector::OnPrimary()
{
	// Mouse + keyboard (or touch + emulated click) can fire together; only count one.
	if (RealTime - LastPrimaryTime < 0.08f)
	{
		return;
	}
	LastPrimaryTime = RealTime;

	switch (State)
	{
	case EStackState::Title:
		StartRun();
		break;
	case EStackState::Playing:
		DropSlider();
		break;
	case EStackState::Collapsing:
		if (StateTime > 0.8f)
		{
			State = EStackState::GameOver;
			StateTime = 0.f;
		}
		break;
	case EStackState::GameOver:
		if (StateTime > 0.5f)
		{
			StartRun();
		}
		break;
	}
}

void ASkyStackDirector::OnTouchPressed(ETouchIndex::Type FingerIndex, FVector Location)
{
	OnPrimary();
}

void ASkyStackDirector::OnRetry()
{
	if (State != EStackState::Title)
	{
		StartRun();
	}
}

void ASkyStackDirector::OnBack()
{
	if (State == EStackState::Title)
	{
		UKismetSystemLibrary::QuitGame(this, Cast<APlayerController>(GetController()), EQuitPreference::Quit, false);
		return;
	}
	Synth->PlayClick();
	EnterTitle();
}

void ASkyStackDirector::OnSelectDaily()
{
	if (State == EStackState::Title && Mode != EStackMode::Daily)
	{
		Mode = EStackMode::Daily;
		Synth->PlayClick();
		RefreshBestMarker();
	}
}

void ASkyStackDirector::OnSelectEndless()
{
	if (State == EStackState::Title && Mode != EStackMode::Endless)
	{
		Mode = EStackMode::Endless;
		Synth->PlayClick();
		RefreshBestMarker();
	}
}

void ASkyStackDirector::OnToggleMode()
{
	if (State == EStackState::Title)
	{
		Mode = Mode == EStackMode::Daily ? EStackMode::Endless : EStackMode::Daily;
		Synth->PlayClick();
		RefreshBestMarker();
	}
}

void ASkyStackDirector::OnCopyShare()
{
	if (State != EStackState::GameOver && State != EStackState::Collapsing)
	{
		return;
	}
	const FString Text = BuildShareText();
	FPlatformApplicationMisc::ClipboardCopy(*Text);
	UE_LOG(LogTemp, Display, TEXT("SkyStack share text:\n%s"), *Text);
	CopiedTimer = 2.5f;
	Synth->PlayClick();
}

void ASkyStackDirector::OnToggleMute()
{
	Save->bMuted = !Save->bMuted;
	Synth->SetMuted(Save->bMuted);
	SaveProgress();
	AddToast(Save->bMuted ? TEXT("SOUND OFF") : TEXT("SOUND ON"), FLinearColor::White, 40.f, 0.8f);
}

// ---------------------------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------------------------

void ASkyStackDirector::EnterTitle()
{
	UGameplayStatics::SetGlobalTimeDilation(this, 1.f);
	SlowMoTimer = 0.f;
	State = EStackState::Title;
	StateTime = 0.f;
	Zone = 0;
	Combo = 0;
	Toasts.Reset();
	ClearTower();
	BuildDemoTower();
	RefreshBestMarker();
	UpdateMusic();
}

void ASkyStackDirector::StartRun()
{
	using namespace SkyStackTuning;

	ClearTower();
	UGameplayStatics::SetGlobalTimeDilation(this, 1.f);
	SlowMoTimer = 0.f;

	// Daily runs share a seed, so everyone gets the same colours, speeds and twists that day.
	const int32 Seed = Mode == EStackMode::Daily ? DailyId * 7919 + 1337 : FMath::Rand();
	Rng.Initialize(Seed);
	HueBase = Rng.FRandRange(0.f, 360.f);

	Floor = 0;
	Combo = 0;
	MaxCombo = 0;
	Perfects = 0;
	Zone = 0;
	RunHeight = 0.0;
	RunLog.Reset();
	Toasts.Reset();
	bNewBest = false;
	bPassedBest = false;
	bCollapsed = false;
	CopiedTimer = 0.f;
	TopCenter = FVector2D::ZeroVector;
	TopSize = FVector2D(BaseSize, BaseSize);
	BestAtStart = GetBest();

	if (Pillar)
	{
		FLinearColor PillarColor = FloorColor(0) * 0.55f;
		PillarColor.A = 1.f;
		Pillar->SetColor(PillarColor);
	}

	if (Mode == EStackMode::Daily && Save->LastDailyPlayed != DailyId)
	{
		Save->DailyStreak = Save->LastDailyPlayed == DailyId - 1 ? Save->DailyStreak + 1 : 1;
		Save->LastDailyPlayed = DailyId;
	}
	++Save->GamesPlayed;
	SaveProgress();

	RefreshBestMarker();
	State = EStackState::Playing;
	StateTime = 0.f;
	Synth->PlayStart();
	AddToast(Mode == EStackMode::Daily ? FString::Printf(TEXT("DAILY #%d"), DailyId) : FString(TEXT("ENDLESS")), FLinearColor::White, 56.f, 1.0f);
	SpawnSlider();
	UpdateMusic();
}

void ASkyStackDirector::SpawnSlider()
{
	using namespace SkyStackTuning;

	const int32 Next = Floor + 1;
	bSliderAlongX = (Next % 2) == 1;
	SliderDir = Rng.FRand() < 0.5f ? 1.f : -1.f;
	SliderOffset = -SliderDir * TravelRange;

	float Speed = FMath::Min(BaseSpeed + SpeedPerFloor * Floor, MaxSpeed) * Rng.FRandRange(0.9f, 1.12f);
	bSliderWobble = Floor >= 12 && Rng.FRand() < 0.18f;
	const bool bRush = Floor >= 25 && !bSliderWobble && Rng.FRand() < 0.12f;
	if (bRush)
	{
		Speed *= 1.35f;
	}
	SliderSpeed = Speed;

	if (bSliderWobble)
	{
		AddToast(TEXT("WOBBLE"), FLinearColor(0.6f, 0.9f, 1.f), 44.f, 0.9f);
		Synth->PlayWarn();
	}
	else if (bRush)
	{
		AddToast(TEXT("RUSH!"), FLinearColor(1.f, 0.35f, 0.3f), 52.f, 0.9f);
		Synth->PlayWarn();
	}

	Slider = SpawnBlock(GetSliderLocation(), FVector(TopSize, BlockHeight), FloorColor(Next));
	if (Slider)
	{
		// Pop in from a sliver so each new floor reads clearly.
		Slider->SetBlockSize(FVector(TopSize * 0.6, BlockHeight * 0.3));
		Slider->TweenSize(FVector(TopSize, BlockHeight), 0.15f);
	}
}

FVector ASkyStackDirector::GetSliderLocation() const
{
	FVector Location(TopCenter, (Floor + 0.5) * SkyStackTuning::BlockHeight);
	if (bSliderAlongX)
	{
		Location.X += SliderOffset;
	}
	else
	{
		Location.Y += SliderOffset;
	}
	return Location;
}

void ASkyStackDirector::DropSlider()
{
	using namespace SkyStackTuning;

	if (!Slider)
	{
		return;
	}

	const double Extent = bSliderAlongX ? TopSize.X : TopSize.Y;
	const double Offset = SliderOffset;
	const double Error = FMath::Abs(Offset);
	if (Error >= Extent)
	{
		MissAndEndRun();
		return;
	}

	const double Z = (Floor + 0.5) * BlockHeight;
	FVector2D NewCenter = TopCenter;
	FVector2D NewSize = TopSize;
	EDropGrade Grade = EDropGrade::Perfect;

	if (Error <= FMath::Max(PerfectTolerance, SliderSpeed * PerfectWindowSeconds))
	{
		++Combo;
		++Perfects;
		MaxCombo = FMath::Max(MaxCombo, Combo);
	}
	else
	{
		Combo = 0;
		const double Kept = Extent - Error;
		const double Side = Offset > 0.0 ? 1.0 : -1.0;
		FVector2D ChipCenter = TopCenter;
		FVector2D ChipSize = TopSize;
		if (bSliderAlongX)
		{
			NewSize.X = Kept;
			NewCenter.X += Offset * 0.5;
			ChipSize.X = Error;
			ChipCenter.X += Offset * 0.5 + Side * Extent * 0.5;
		}
		else
		{
			NewSize.Y = Kept;
			NewCenter.Y += Offset * 0.5;
			ChipSize.Y = Error;
			ChipCenter.Y += Offset * 0.5 + Side * Extent * 0.5;
		}

		// The overhang breaks off and tumbles away under real physics.
		if (ASkyStackBlock* Chip = SpawnBlock(FVector(ChipCenter, Z), FVector(ChipSize, BlockHeight), Slider->GetColor()))
		{
			const FVector Push = bSliderAlongX ? FVector(Side, 0.0, 0.0) : FVector(0.0, Side, 0.0);
			Chip->MakeDebris(Push * 140.0 + FVector(0.0, 0.0, 60.0), RandomSpin(160.f));
			Chip->SetLifeSpan(5.f);
			Debris.Add(Chip);
		}
		Grade = Kept / Extent < ClutchRatio ? EDropGrade::Clutch : EDropGrade::Good;
	}

	ASkyStackBlock* Placed = Slider;
	Slider = nullptr;
	Placed->SetBlockSize(FVector(NewSize, BlockHeight));
	Placed->SetActorLocation(FVector(NewCenter, Z));
	Placed->Squash(Grade == EDropGrade::Perfect ? 0.3f : 0.18f);
	Tower.Add(Placed);

	TopCenter = NewCenter;
	TopSize = NewSize;
	++Floor;
	RunLog.Add(Grade);
	RunHeight = Floor * BlockHeight;
	ScorePop = 1.f;

	const FVector TopMiddle(NewCenter, Floor * BlockHeight);
	switch (Grade)
	{
	case EDropGrade::Perfect:
	{
		Synth->PlayPerfect(Combo);
		SpawnPerfectHalo(FVector(NewCenter, Z), NewSize);
		AddTrauma(0.12f);
		FringePulse = FMath::Max(FringePulse, 0.5f);
		const FString Label = Combo > 1 ? FString::Printf(TEXT("PERFECT x%d"), Combo) : FString(TEXT("PERFECT"));
		AddToast(Label, FLinearColor(1.f, 0.85f, 0.25f), 60.f + FMath::Min(Combo, 10) * 4.f);
		if (Combo >= 3)
		{
			SpawnConfetti(TopMiddle, FMath::Min(8 + Combo * 2, 30));
		}
		if (Combo >= ComboToGrow && (TopSize.X < BaseSize || TopSize.Y < BaseSize))
		{
			// Streaks earn width back.
			TopSize.X = FMath::Min(TopSize.X + GrowAmount, BaseSize);
			TopSize.Y = FMath::Min(TopSize.Y + GrowAmount, BaseSize);
			Placed->TweenSize(FVector(TopSize, BlockHeight), 0.3f);
			Synth->PlayGrow();
			AddToast(TEXT("+ GROW"), FLinearColor(0.45f, 1.f, 0.7f), 40.f, 0.9f);
		}
		break;
	}
	case EDropGrade::Good:
		Synth->PlayChop();
		AddTrauma(0.18f);
		break;
	case EDropGrade::Clutch:
		Synth->PlayChop();
		Synth->PlayClutch();
		AddTrauma(0.4f);
		FringePulse = 1.f;
		StartSlowMo(0.3f, 0.45f);
		AddToast(TEXT("CLUTCH!"), FLinearColor(1.f, 0.4f, 0.25f), 84.f, 1.2f);
		break;
	}

	const int32 NewZone = ZoneForFloor(Floor);
	if (NewZone != Zone)
	{
		Zone = NewZone;
		AddToast(GetZoneName(), FLinearColor::White, 76.f, 2.2f);
		Synth->PlayZone();
		AddTrauma(0.2f);
		SpawnConfetti(TopMiddle, 30);
	}

	if (!bPassedBest && BestAtStart > 0 && Floor > BestAtStart)
	{
		bPassedBest = true;
		AddToast(TEXT("NEW RECORD!"), FLinearColor(1.f, 0.75f, 0.1f), 88.f, 1.8f);
		Synth->PlayRecord();
		SpawnConfetti(TopMiddle, 40);
		for (ASkyStackBlock* Bar : BestMarker)
		{
			if (IsValid(Bar))
			{
				Bar->ShrinkAway(0.6f);
			}
		}
		BestMarker.Reset();
	}

	UpdateMusic();
	SpawnSlider();
}

void ASkyStackDirector::MissAndEndRun()
{
	if (Slider)
	{
		const FVector Push = bSliderAlongX ? FVector(SliderDir, 0.f, 0.f) : FVector(0.f, SliderDir, 0.f);
		Slider->MakeDebris(Push * 250.0, RandomSpin(90.f));
		Slider->SetLifeSpan(8.f);
		Debris.Add(Slider);
		Slider = nullptr;
	}

	State = EStackState::Collapsing;
	StateTime = 0.f;
	bCollapsed = false;
	Combo = 0;
	RunHeight = Floor * SkyStackTuning::BlockHeight;
	bNewBest = Floor > BestAtStart;

	if (Mode == EStackMode::Daily)
	{
		Save->BestDaily = FMath::Max(Save->BestDaily, Floor);
		Save->BestDailyId = DailyId;
	}
	else
	{
		Save->BestEndless = FMath::Max(Save->BestEndless, Floor);
	}
	Save->TotalFloors += Floor;
	SaveProgress();

	Synth->PlayMiss();
	AddTrauma(0.7f);
	FringePulse = 1.5f;
	StartSlowMo(0.35f, 2.0f);
	UpdateMusic();
}

void ASkyStackDirector::CollapseTower()
{
	bCollapsed = true;
	const int32 Count = Tower.Num();
	for (int32 Index = 0; Index < Count; ++Index)
	{
		ASkyStackBlock* Block = Tower[Index];
		if (!IsValid(Block))
		{
			continue;
		}
		// Higher floors get flung harder, so the tower peels apart from the top.
		const double Height01 = Count > 1 ? static_cast<double>(Index) / (Count - 1) : 1.0;
		const FVector2D Dir = FVector2D(FMath::FRandRange(-1.0, 1.0), FMath::FRandRange(-1.0, 1.0)).GetSafeNormal();
		const double Strength = 60.0 + 380.0 * Height01;
		Block->MakeDebris(FVector(Dir * Strength, 40.0 * Height01), RandomSpin(150.f));
	}

	if (Count > 0)
	{
		Synth->PlayCollapse();
		AddTrauma(0.6f);
		AddToast(TEXT("TIMBER!"), FLinearColor(1.f, 0.55f, 0.3f), 96.f, 1.6f);
	}
}

void ASkyStackDirector::ClearTower()
{
	for (ASkyStackBlock* Block : Tower)
	{
		if (IsValid(Block))
		{
			Block->Destroy();
		}
	}
	Tower.Reset();

	if (IsValid(Slider))
	{
		Slider->Destroy();
	}
	Slider = nullptr;

	for (const TWeakObjectPtr<ASkyStackBlock>& Piece : Debris)
	{
		if (Piece.IsValid())
		{
			Piece->Destroy();
		}
	}
	Debris.Reset();
}

void ASkyStackDirector::BuildDemoTower()
{
	using namespace SkyStackTuning;

	// A pretty little tower for the title screen to orbit.
	HueBase = FMath::FRandRange(0.f, 360.f);
	FVector2D Size(BaseSize, BaseSize);
	FVector2D Center = FVector2D::ZeroVector;
	constexpr int32 DemoFloors = 14;
	for (int32 Index = 1; Index <= DemoFloors; ++Index)
	{
		const double Trim = FMath::FRandRange(0.0, 16.0);
		const double Shift = FMath::RandBool() ? Trim * 0.5 : -Trim * 0.5;
		if (Index % 2 == 1)
		{
			Size.X -= Trim;
			Center.X += Shift;
		}
		else
		{
			Size.Y -= Trim;
			Center.Y += Shift;
		}
		Tower.Add(SpawnBlock(FVector(Center, (Index - 0.5) * BlockHeight), FVector(Size, BlockHeight), FloorColor(Index)));
	}
	RunHeight = DemoFloors * BlockHeight;
	Floor = 0;

	if (Pillar)
	{
		FLinearColor PillarColor = FloorColor(0) * 0.55f;
		PillarColor.A = 1.f;
		Pillar->SetColor(PillarColor);
	}
}

void ASkyStackDirector::BuildEnvironment()
{
	using namespace SkyStackTuning;

	Pillar = SpawnBlock(FVector(0.0, 0.0, -PillarDepth * 0.5), FVector(BaseSize, BaseSize, PillarDepth), FLinearColor(0.2f, 0.2f, 0.25f));

	// Ground plus a far-away box of thin slabs. We see the inner faces, the fog turns them
	// into sky, and debris has something to land on.
	constexpr double R = 40000.0;
	constexpr double Thin = 100.0;
	const FVector Slabs[][2] =
	{
		{ FVector(0.0, 0.0, -PillarDepth - Thin * 0.5), FVector(2.0 * R, 2.0 * R, Thin) },
		{ FVector(0.0, 0.0, R), FVector(2.0 * R, 2.0 * R, Thin) },
		{ FVector(R, 0.0, 0.0), FVector(Thin, 2.0 * R, 2.0 * R) },
		{ FVector(-R, 0.0, 0.0), FVector(Thin, 2.0 * R, 2.0 * R) },
		{ FVector(0.0, R, 0.0), FVector(2.0 * R, Thin, 2.0 * R) },
		{ FVector(0.0, -R, 0.0), FVector(2.0 * R, Thin, 2.0 * R) },
	};
	for (int32 Index = 0; Index < static_cast<int32>(UE_ARRAY_COUNT(Slabs)); ++Index)
	{
		if (ASkyStackBlock* Slab = SpawnBlock(Slabs[Index][0], Slabs[Index][1], FogColor))
		{
			Slab->SetCastsShadow(false);
			if (Index > 0)
			{
				Slab->DisableCollision();
			}
			Backdrop.Add(Slab);
		}
	}

	// Puffy low-poly clouds the tower climbs through.
	FRandomStream CloudRng(4242);
	for (int32 Cluster = 0; Cluster < 60; ++Cluster)
	{
		const double Angle = CloudRng.FRandRange(0.f, 2.f * PI);
		const double Radius = CloudRng.FRandRange(1500.f, 4200.f);
		const FVector Center(FMath::Cos(Angle) * Radius, FMath::Sin(Angle) * Radius, CloudRng.FRandRange(400.f, 3400.f));
		const float Speed = CloudRng.FRandRange(15.f, 45.f);
		const int32 Puffs = CloudRng.RandRange(3, 5);
		for (int32 Puff = 0; Puff < Puffs; ++Puff)
		{
			const FVector Offset(CloudRng.FRandRange(-220.f, 220.f), CloudRng.FRandRange(-120.f, 120.f), CloudRng.FRandRange(-30.f, 40.f));
			const double Diameter = CloudRng.FRandRange(180.f, 360.f);
			if (ASkyStackBlock* Cloud = SpawnBlock(Center + Offset, FVector(Diameter, Diameter * 0.8, Diameter * 0.55), FLinearColor(0.95f, 0.96f, 1.f)))
			{
				Cloud->UseSphereMesh();
				Cloud->DisableCollision();
				Cloud->SetCastsShadow(false);
				Clouds.Add(Cloud);
				CloudSpeeds.Add(Speed);
			}
		}
	}
}

void ASkyStackDirector::RefreshBestMarker()
{
	using namespace SkyStackTuning;

	for (ASkyStackBlock* Bar : BestMarker)
	{
		if (IsValid(Bar))
		{
			Bar->Destroy();
		}
	}
	BestMarker.Reset();

	const int32 Best = GetBest();
	if (Best <= 0)
	{
		return;
	}

	// A gold frame hanging at your record height: the thing you're climbing toward.
	const double Z = Best * BlockHeight;
	const double S = BaseSize + 110.0;
	constexpr double T = 10.0;
	const FVector Bars[][2] =
	{
		{ FVector(0.0, S * 0.5, Z), FVector(S + T, T, T) },
		{ FVector(0.0, -S * 0.5, Z), FVector(S + T, T, T) },
		{ FVector(S * 0.5, 0.0, Z), FVector(T, S + T, T) },
		{ FVector(-S * 0.5, 0.0, Z), FVector(T, S + T, T) },
	};
	for (const auto& Bar : Bars)
	{
		if (ASkyStackBlock* Block = SpawnBlock(Bar[0], Bar[1], FLinearColor(1.f, 0.72f, 0.12f)))
		{
			Block->DisableCollision();
			Block->SetCastsShadow(false);
			BestMarker.Add(Block);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Per frame
// ---------------------------------------------------------------------------------------------

void ASkyStackDirector::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// Presentation runs on real time so slow-mo only slows the world, not the camera or UI.
	const float RealDt = FMath::Min(static_cast<float>(FApp::GetDeltaTime()), 0.1f);
	RealTime += RealDt;
	StateTime += RealDt;

	if (SlowMoTimer > 0.f)
	{
		SlowMoTimer -= RealDt;
		if (SlowMoTimer <= 0.f)
		{
			UGameplayStatics::SetGlobalTimeDilation(this, 1.f);
		}
	}

	if (State == EStackState::Playing)
	{
		UpdateSlider(DeltaSeconds);
	}
	else if (State == EStackState::Collapsing)
	{
		if (!bCollapsed && StateTime > 0.5f)
		{
			CollapseTower();
		}
		if (StateTime > 2.3f)
		{
			State = EStackState::GameOver;
			StateTime = 0.f;
		}
	}

	UpdateClouds(DeltaSeconds);
	UpdateAtmosphere(RealDt);
	UpdateCamera(RealDt);
	UpdateToasts(RealDt);

	ScorePop = FMath::Max(0.f, ScorePop - RealDt * 4.f);
	CopiedTimer = FMath::Max(0.f, CopiedTimer - RealDt);
}

void ASkyStackDirector::UpdateSlider(float GameDt)
{
	using namespace SkyStackTuning;

	if (!Slider)
	{
		return;
	}

	float Speed = SliderSpeed;
	if (bSliderWobble)
	{
		Speed *= 1.f + 0.6f * FMath::Sin(StateTime * 4.2f);
	}
	SliderOffset += SliderDir * Speed * GameDt;
	if (SliderOffset > TravelRange)
	{
		SliderOffset = TravelRange;
		SliderDir = -1.f;
	}
	else if (SliderOffset < -TravelRange)
	{
		SliderOffset = -TravelRange;
		SliderDir = 1.f;
	}
	Slider->SetActorLocation(GetSliderLocation());
}

void ASkyStackDirector::UpdateCamera(float RealDt)
{
	using namespace SkyStackTuning;

	FVector Goal;
	float GoalDist;
	float GoalPitch = -28.f;
	switch (State)
	{
	case EStackState::Title:
		Goal = FVector(0.0, 0.0, RunHeight * 0.55 + 20.0);
		GoalDist = 1250.f;
		GoalPitch = -20.f;
		CamYaw += 9.f * RealDt;
		break;
	case EStackState::Playing:
		Goal = FVector(TopCenter * 0.5, Floor * BlockHeight + 50.0);
		GoalDist = 1150.f;
		CamYaw += FMath::FindDeltaAngleDegrees(CamYaw, 225.f) * FMath::Min(1.f, RealDt * 2.5f);
		break;
	default:
		// Pull back and orbit so the whole collapse is in frame. Made for clips.
		Goal = FVector(0.0, 0.0, RunHeight * 0.45);
		GoalDist = 1150.f + static_cast<float>(RunHeight) * 1.05f;
		GoalPitch = -24.f;
		CamYaw += 10.f * RealDt;
		break;
	}
	CamYaw = FMath::Fmod(CamYaw, 360.f);

	CamTarget = FMath::VInterpTo(CamTarget, Goal, RealDt, 3.5f);
	CamDist = FMath::FInterpTo(CamDist, GoalDist, RealDt, 2.f);
	CamPitch = FMath::FInterpTo(CamPitch, GoalPitch, RealDt, 2.f);

	const FRotator ViewRotation(CamPitch, CamYaw, 0.f);
	FVector Location = CamTarget - ViewRotation.Vector() * CamDist;

	// Trauma-based screen shake: squared so small hits stay subtle and big ones really kick.
	Trauma = FMath::Max(0.f, Trauma - RealDt * 1.6f);
	const float Shake = Trauma * Trauma;
	const float T = RealTime * 24.f;
	Location += FVector(FMath::PerlinNoise1D(T), FMath::PerlinNoise1D(T + 31.7f), FMath::PerlinNoise1D(T + 71.3f)) * (28.f * Shake);
	const FRotator ShakeRotation(
		FMath::PerlinNoise1D(T + 13.1f) * 2.f * Shake,
		FMath::PerlinNoise1D(T + 47.9f) * 2.f * Shake,
		FMath::PerlinNoise1D(T + 91.3f) * 4.f * Shake);

	Camera->SetWorldLocationAndRotation(Location, ViewRotation + ShakeRotation);
}

void ASkyStackDirector::UpdateAtmosphere(float RealDt)
{
	const FZoneInfo& Target = GZones[FMath::Clamp(Zone, 0, NumZones - 1)];

	FogColor = FMath::CInterpTo(FogColor, Target.Fog, RealDt, 1.2f);
	Fog->SetFogInscatteringColor(FogColor);
	Fog->SetStartDistance(CamDist + 600.f);
	for (ASkyStackBlock* Slab : Backdrop)
	{
		if (Slab)
		{
			Slab->SetColor(FogColor);
		}
	}

	SunColor = FMath::CInterpTo(SunColor, Target.Sun, RealDt, 1.2f);
	SunIntensity = FMath::FInterpTo(SunIntensity, Target.SunIntensity, RealDt, 1.2f);
	SunPitch = FMath::FInterpTo(SunPitch, Target.SunPitch, RealDt, 1.2f);
	KeyLight->SetLightColor(SunColor);
	KeyLight->SetIntensity(SunIntensity);
	KeyLight->SetWorldRotation(FRotator(SunPitch, 200.f, 0.f));

	FringePulse = FMath::Max(0.f, FringePulse - RealDt * 2.5f);
	PostFX->Settings.SceneFringeIntensity = 0.4f + FringePulse * 3.f;
}

void ASkyStackDirector::UpdateClouds(float GameDt)
{
	for (int32 Index = 0; Index < Clouds.Num(); ++Index)
	{
		ASkyStackBlock* Cloud = Clouds[Index];
		if (!Cloud)
		{
			continue;
		}
		FVector Location = Cloud->GetActorLocation();
		Location.X += CloudSpeeds[Index] * GameDt;
		if (Location.X > 5000.0)
		{
			Location.X -= 10000.0;
		}
		Cloud->SetActorLocation(Location);
	}
}

void ASkyStackDirector::UpdateToasts(float RealDt)
{
	for (int32 Index = Toasts.Num() - 1; Index >= 0; --Index)
	{
		Toasts[Index].Age += RealDt;
		if (Toasts[Index].Age >= Toasts[Index].Life)
		{
			Toasts.RemoveAt(Index);
		}
	}
}

void ASkyStackDirector::UpdateMusic()
{
	int32 Level = 0;
	switch (State)
	{
	case EStackState::Title:
		Level = 0;
		break;
	case EStackState::Playing:
		// The beat builds as you climb and as your streak grows.
		Level = 1;
		Level += (Combo >= 3 || Floor >= 20) ? 1 : 0;
		Level += (Combo >= 6 || Floor >= 60) ? 1 : 0;
		break;
	default:
		Level = -1;
		break;
	}
	Synth->SetMusicLevel(Level);
}

// ---------------------------------------------------------------------------------------------
// Juice
// ---------------------------------------------------------------------------------------------

void ASkyStackDirector::AddToast(const FString& Text, const FLinearColor& Color, float Size, float Life)
{
	FStackToast& Toast = Toasts.AddDefaulted_GetRef();
	Toast.Text = Text;
	Toast.Color = Color;
	Toast.Size = Size;
	Toast.Life = Life;
	if (Toasts.Num() > 4)
	{
		Toasts.RemoveAt(0);
	}
}

void ASkyStackDirector::AddTrauma(float Amount)
{
	Trauma = FMath::Min(1.f, Trauma + Amount);
}

void ASkyStackDirector::StartSlowMo(float Dilation, float RealDuration)
{
	UGameplayStatics::SetGlobalTimeDilation(this, Dilation);
	SlowMoTimer = RealDuration;
}

void ASkyStackDirector::SpawnPerfectHalo(const FVector& Center, const FVector2D& Footprint)
{
	// A thin white plate hidden inside the block that bursts outward as a glowing rim.
	ASkyStackBlock* Halo = SpawnBlock(Center, FVector(Footprint + FVector2D(6.0, 6.0), SkyStackTuning::BlockHeight * 0.5), FLinearColor(1.5f, 1.5f, 1.5f));
	if (Halo)
	{
		Halo->DisableCollision();
		Halo->SetCastsShadow(false);
		Halo->TweenSize(FVector(Footprint + FVector2D(150.0, 150.0), 2.0), 0.45f, true);
	}
}

void ASkyStackDirector::SpawnConfetti(const FVector& Origin, int32 Count)
{
	for (int32 Index = 0; Index < Count; ++Index)
	{
		const FVector Start = Origin + FVector(FMath::FRandRange(-60.0, 60.0), FMath::FRandRange(-60.0, 60.0), 10.0);
		const FLinearColor Color = FLinearColor(FMath::FRandRange(0.f, 360.f), 0.7f, 1.f).HSVToLinearRGB();
		if (ASkyStackBlock* Bit = SpawnBlock(Start, FVector(12.0, 12.0, 4.0), Color))
		{
			Bit->SetCastsShadow(false);
			Bit->Launch(
				FVector(FMath::FRandRange(-380.0, 380.0), FMath::FRandRange(-380.0, 380.0), FMath::FRandRange(500.0, 950.0)),
				FRotator(FMath::FRandRange(-720.f, 720.f), FMath::FRandRange(-720.f, 720.f), FMath::FRandRange(-720.f, 720.f)));
			Bit->ShrinkAway(1.4f);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

ASkyStackBlock* ASkyStackDirector::SpawnBlock(const FVector& Center, const FVector& Size, const FLinearColor& Color)
{
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	ASkyStackBlock* Block = GetWorld()->SpawnActor<ASkyStackBlock>(ASkyStackBlock::StaticClass(), Center, FRotator::ZeroRotator, Params);
	if (Block)
	{
		Block->SetBlockSize(Size);
		Block->SetColor(Color);
	}
	return Block;
}

FLinearColor ASkyStackDirector::FloorColor(int32 FloorIndex) const
{
	// Slow hue drift up the tower: the classic gradient-stack look.
	const float Hue = FMath::Fmod(HueBase + FloorIndex * 5.5f, 360.f);
	return FLinearColor(Hue, 0.62f, 0.95f).HSVToLinearRGB();
}

int32 ASkyStackDirector::GetBest() const
{
	if (!Save)
	{
		return 0;
	}
	return Mode == EStackMode::Daily ? Save->BestDaily : Save->BestEndless;
}

int32 ASkyStackDirector::ZoneForFloor(int32 FloorIndex) const
{
	return FMath::Clamp(FloorIndex / SkyStackTuning::FloorsPerZone, 0, NumZones - 1);
}

FString ASkyStackDirector::GetZoneName() const
{
	return GZones[FMath::Clamp(Zone, 0, NumZones - 1)].Name;
}

FString ASkyStackDirector::GetTaunt() const
{
	if (Floor == 0)   return TEXT("The first block is free. You missed it anyway.");
	if (Floor < 5)    return TEXT("Gravity 1, you 0.");
	if (Floor < 10)   return TEXT("Warming up. Surely.");
	if (Floor < 20)   return TEXT("Mid tower energy.");
	if (Floor < 35)   return TEXT("Okay, architect.");
	if (Floor < 50)   return TEXT("Your friends won't beat this. Probably.");
	if (Floor < 75)   return TEXT("Built different.");
	if (Floor < 100)  return TEXT("The clouds are concerned.");
	return TEXT("Touch grass. From orbit.");
}

FString ASkyStackDirector::BuildShareText() const
{
	FString Out = Mode == EStackMode::Daily
		? FString::Printf(TEXT("SKYSTACK Daily #%d: %d floors "), DailyId, Floor)
		: FString::Printf(TEXT("SKYSTACK Endless: %d floors "), Floor);
	AppendCodepoint(Out, 0x1F3D7); // building construction
	AppendCodepoint(Out, 0xFE0F);
	Out += TEXT("\n");

	// Wordle-style grid: one square per floor, newest last, capped at five rows.
	const int32 Shown = FMath::Min(RunLog.Num(), 50);
	const int32 First = RunLog.Num() - Shown;
	if (First > 0)
	{
		Out += FString::Printf(TEXT("(+%d floors below)\n"), First);
	}
	for (int32 Index = First; Index < RunLog.Num(); ++Index)
	{
		switch (RunLog[Index])
		{
		case EDropGrade::Perfect: AppendCodepoint(Out, 0x1F7E9); break; // green square
		case EDropGrade::Good:    AppendCodepoint(Out, 0x1F7E8); break; // yellow square
		case EDropGrade::Clutch:  AppendCodepoint(Out, 0x1F7E7); break; // orange square
		}
		if ((Index - First + 1) % 10 == 0)
		{
			Out += TEXT("\n");
		}
	}
	AppendCodepoint(Out, 0x1F4A5); // collision: where it fell
	Out += TEXT("\n");

	AppendCodepoint(Out, 0x2B50); // star
	Out += FString::Printf(TEXT(" %d perfect  "), Perfects);
	AppendCodepoint(Out, 0x1F525); // fire
	Out += FString::Printf(TEXT(" %d max combo\n"), MaxCombo);
	Out += TEXT("Can you beat it? #SkyStack");
	return Out;
}

FVector ASkyStackDirector::GetBestMarkerLocation() const
{
	const double S = (SkyStackTuning::BaseSize + 110.0) * 0.5;
	return FVector(S, S, GetBest() * SkyStackTuning::BlockHeight);
}

float ASkyStackDirector::GetDanger() const
{
	if (State != EStackState::Playing)
	{
		return 0.f;
	}
	const double Narrowest = FMath::Min(TopSize.X, TopSize.Y);
	return FMath::Clamp(static_cast<float>(1.0 - Narrowest / (SkyStackTuning::BaseSize * 0.3)), 0.f, 1.f);
}

void ASkyStackDirector::SaveProgress()
{
	if (Save)
	{
		UGameplayStatics::SaveGameToSlot(Save, SkyStackTuning::SaveSlot, 0);
	}
}
