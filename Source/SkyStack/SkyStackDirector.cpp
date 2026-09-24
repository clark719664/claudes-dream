#include "SkyStackDirector.h"

#include "SkyStackBlock.h"
#include "SkyStackSave.h"
#include "SkySynth.h"

#include "Camera/CameraComponent.h"
#include "Components/AudioComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/InputComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/PostProcessComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "HAL/PlatformApplicationMisc.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/App.h"
#include "UObject/ConstructorHelpers.h"

namespace SkyStackTuning
{
	constexpr double BlockHeight = 36.0;
	constexpr double BaseSize = 320.0;
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
	constexpr float CameraFov = 55.f;
	/** The tower starts on a sea cliff this high, then every floor climbs further. */
	constexpr double StartAltitudeMeters = 300.0;
	constexpr int32 SparkPool = 700;
	constexpr int32 StarCount = 1400;
	static const TCHAR* const SaveSlot = TEXT("SkyStack");
}

namespace
{
	/** Each zone is a moment in a day-to-orbit journey: sun position, light, and how the tower glows. */
	struct FZoneInfo
	{
		const TCHAR* Name;
		float SunElevation;
		float SunYaw;
		FLinearColor SunColor;
		float MoonIntensity;
		float EdgeGlow;
		float CameraPitch;
		float StarFade;
		float ExposureBias;
	};

	const FZoneInfo GZones[] =
	{
		{ TEXT("SUNRISE"),        7.f, 150.f, FLinearColor(1.00f, 0.82f, 0.66f), 0.0f, 1.0f, -24.f, 0.0f,  0.0f },
		{ TEXT("CLOUD LINE"),    32.f, 170.f, FLinearColor(1.00f, 0.95f, 0.90f), 0.0f, 1.0f, -22.f, 0.0f,  0.0f },
		{ TEXT("SEA OF CLOUDS"), 58.f, 200.f, FLinearColor(1.00f, 1.00f, 1.00f), 0.0f, 1.0f, -18.f, 0.0f,  0.0f },
		{ TEXT("GOLDEN HOUR"),    4.f,  45.f, FLinearColor(1.00f, 0.78f, 0.52f), 0.0f, 1.6f, -11.f, 0.0f,  0.0f },
		{ TEXT("NIGHTFALL"),     -9.f,  60.f, FLinearColor(1.00f, 0.60f, 0.50f), 0.5f, 5.0f, -16.f, 1.0f, -0.7f },
		{ TEXT("STRATOSPHERE"),   3.f,  80.f, FLinearColor(1.00f, 0.80f, 0.65f), 0.0f, 2.5f, -12.f, 0.6f,  0.0f },
		{ TEXT("ORBIT"),         24.f, 120.f, FLinearColor(1.00f, 1.00f, 1.00f), 0.0f, 2.5f, -14.f, 1.0f,  0.0f },
	};
	constexpr int32 NumZones = UE_ARRAY_COUNT(GZones);

	/** Hand-picked three-stop gradients; the daily seed picks one so everyone's tower matches. */
	struct FPaletteInfo
	{
		const TCHAR* Name;
		uint32 Stops[3];
	};

	const FPaletteInfo GPalettes[] =
	{
		{ TEXT("LAGOON"),  { 0x3EC5E0, 0x6A7CFF, 0xC86BFA } },
		{ TEXT("CANDY"),   { 0xFF7AA8, 0xFFB36B, 0xFFE66B } },
		{ TEXT("AURORA"),  { 0x4DF2B0, 0x3AA8FF, 0x9B6BFF } },
		{ TEXT("EMBER"),   { 0xFF5E5E, 0xFF9A3D, 0xFFD166 } },
		{ TEXT("BLOSSOM"), { 0xF7A8FF, 0x8FD3FF, 0xB8FFD9 } },
		{ TEXT("COASTAL"), { 0x00C2A8, 0xF9F871, 0xFF9671 } },
	};
	constexpr int32 NumPalettes = UE_ARRAY_COUNT(GPalettes);

	FLinearColor HexToLinear(uint32 Hex)
	{
		return FLinearColor(FColor((Hex >> 16) & 0xFF, (Hex >> 8) & 0xFF, Hex & 0xFF));
	}

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

	FTransform HiddenInstance()
	{
		return FTransform(FRotator::ZeroRotator, FVector(0.0, 0.0, -1.0e7), FVector(0.0001));
	}

	UInstancedStaticMeshComponent* MakeEffectMesh(AActor* Owner, USceneComponent* Parent, const TCHAR* Name, UStaticMesh* Mesh)
	{
		UInstancedStaticMeshComponent* Component = Owner->CreateDefaultSubobject<UInstancedStaticMeshComponent>(Name);
		Component->SetupAttachment(Parent);
		Component->SetUsingAbsoluteLocation(true);
		Component->SetUsingAbsoluteRotation(true);
		Component->SetMobility(EComponentMobility::Movable);
		Component->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Component->SetGenerateOverlapEvents(false);
		Component->SetCastShadow(false);
		Component->bAffectDistanceFieldLighting = false;
		Component->bAffectDynamicIndirectLighting = false;
		Component->NumCustomDataFloats = 4;
		if (Mesh)
		{
			Component->SetStaticMesh(Mesh);
		}
		return Component;
	}
}

ASkyStackDirector::ASkyStackDirector()
{
	PrimaryActorTick.bCanEverTick = true;
	bUseControllerRotationPitch = false;
	bUseControllerRotationYaw = false;
	bUseControllerRotationRoll = false;

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeFinder(TEXT("/Engine/BasicShapes/Cube.Cube"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> CloudFinder(TEXT("/Engine/EngineSky/VolumetricClouds/m_SimpleVolumetricCloud_Inst.m_SimpleVolumetricCloud_Inst"));
	CloudMaterial = CloudFinder.Object;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent = Root;

	// Camera with cinematic depth of field focused on the top of the tower.
	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(Root);
	Camera->SetUsingAbsoluteLocation(true);
	Camera->SetUsingAbsoluteRotation(true);
	Camera->SetFieldOfView(SkyStackTuning::CameraFov);
	Camera->bConstrainAspectRatio = false;
	Camera->PostProcessBlendWeight = 1.f;
	Camera->PostProcessSettings.bOverride_DepthOfFieldFstop = true;
	Camera->PostProcessSettings.DepthOfFieldFstop = 2.8f;
	Camera->PostProcessSettings.bOverride_DepthOfFieldFocalDistance = true;
	Camera->PostProcessSettings.DepthOfFieldFocalDistance = 1500.f;

	// Sun and moon both drive the sky atmosphere (the moon is atmosphere light #1).
	Sun = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("Sun"));
	Sun->SetupAttachment(Root);
	Sun->SetMobility(EComponentMobility::Movable);
	Sun->SetUsingAbsoluteRotation(true);
	Sun->SetRelativeRotation(FRotator(-7.f, 150.f, 0.f));
	Sun->Intensity = 10.f;
	Sun->LightSourceAngle = 0.8f;
	Sun->bAtmosphereSunLight = true;
	Sun->AtmosphereSunLightIndex = 0;

	Moon = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("Moon"));
	Moon->SetupAttachment(Root);
	Moon->SetMobility(EComponentMobility::Movable);
	Moon->SetUsingAbsoluteRotation(true);
	Moon->SetRelativeRotation(FRotator(-38.f, 250.f, 0.f));
	Moon->Intensity = 0.f;
	Moon->LightColor = FColor(160, 185, 255);
	Moon->LightSourceAngle = 0.5f;
	Moon->bAtmosphereSunLight = true;
	Moon->AtmosphereSunLightIndex = 1;

	SkyLight = CreateDefaultSubobject<USkyLightComponent>(TEXT("SkyLight"));
	SkyLight->SetupAttachment(Root);
	SkyLight->SetMobility(EComponentMobility::Movable);
	SkyLight->SourceType = SLS_CapturedScene;
	SkyLight->bRealTimeCapture = true;
	SkyLight->Intensity = 1.f;

	// The planet. Its top sits at the component, which we sink as the tower climbs.
	Atmosphere = CreateDefaultSubobject<USkyAtmosphereComponent>(TEXT("Atmosphere"));
	Atmosphere->SetupAttachment(Root);
	Atmosphere->SetUsingAbsoluteLocation(true);
	Atmosphere->TransformMode = ESkyAtmosphereTransformMode::PlanetTopAtComponentTransform;
	Atmosphere->GroundAlbedo = FColor(18, 46, 72); // deep ocean, so orbit shows a blue planet

	CloudLayer = CreateDefaultSubobject<UVolumetricCloudComponent>(TEXT("Clouds"));
	CloudLayer->SetupAttachment(Root);
	CloudLayer->SetUsingAbsoluteLocation(true);
	CloudLayer->SetLayerBottomAltitude(1.6f);
	CloudLayer->SetLayerHeight(1.6f);

	Fog = CreateDefaultSubobject<UExponentialHeightFogComponent>(TEXT("Fog"));
	Fog->SetupAttachment(Root);
	Fog->SetUsingAbsoluteLocation(true);
	Fog->SetFogDensity(0.015f);
	Fog->SetFogHeightFalloff(0.2f);
	Fog->SetVolumetricFog(true);
	Fog->SetVolumetricFogScatteringDistribution(0.75f);

	PostFX = CreateDefaultSubobject<UPostProcessComponent>(TEXT("PostFX"));
	PostFX->SetupAttachment(Root);
	PostFX->bUnbound = true;
	FPostProcessSettings& Settings = PostFX->Settings;
	Settings.bOverride_AutoExposureMinBrightness = true;
	Settings.AutoExposureMinBrightness = 1.f;
	Settings.bOverride_AutoExposureMaxBrightness = true;
	Settings.AutoExposureMaxBrightness = 14.f;
	Settings.bOverride_AutoExposureSpeedUp = true;
	Settings.AutoExposureSpeedUp = 2.5f;
	Settings.bOverride_AutoExposureSpeedDown = true;
	Settings.AutoExposureSpeedDown = 1.5f;
	Settings.bOverride_AutoExposureBias = true;
	Settings.AutoExposureBias = 0.f;
	Settings.bOverride_BloomIntensity = true;
	Settings.BloomIntensity = 0.9f;
	Settings.bOverride_LensFlareIntensity = true;
	Settings.LensFlareIntensity = 0.35f;
	Settings.bOverride_VignetteIntensity = true;
	Settings.VignetteIntensity = 0.35f;
	Settings.bOverride_SceneFringeIntensity = true;
	Settings.SceneFringeIntensity = 0.3f;
	Settings.bOverride_MotionBlurAmount = true;
	Settings.MotionBlurAmount = 0.25f;
	Settings.bOverride_FilmGrainIntensity = true;
	Settings.FilmGrainIntensity = 0.05f;
	Settings.bOverride_ColorSaturation = true;
	Settings.ColorSaturation = FVector4(1.06, 1.06, 1.06, 1.0);
	Settings.bOverride_ColorContrast = true;
	Settings.ColorContrast = FVector4(1.04, 1.04, 1.04, 1.0);
	Settings.bOverride_SceneColorTint = true;
	Settings.SceneColorTint = FLinearColor::White;

	SparkMesh = MakeEffectMesh(this, Root, TEXT("Sparks"), CubeFinder.Object);
	StarMesh = MakeEffectMesh(this, Root, TEXT("Stars"), CubeFinder.Object);

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

	if (CloudMaterial)
	{
		CloudLayer->SetMaterial(CloudMaterial);
	}

	const FZoneInfo& FirstZone = GZones[0];
	SunElevation = FirstZone.SunElevation;
	SunYaw = FirstZone.SunYaw;
	SunColor = FirstZone.SunColor;
	EdgeGlow = FirstZone.EdgeGlow;
	AltitudeMeters = SkyStackTuning::StartAltitudeMeters;

	BuildWorld();
	EnterTitle();
	CamTarget = FVector(0.0, 0.0, RunHeight * 0.5);
}

void ASkyStackDirector::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	for (const FKey& Key : { EKeys::SpaceBar, EKeys::LeftMouseButton, EKeys::Enter, EKeys::Gamepad_FaceButton_Bottom, EKeys::Gamepad_Special_Right })
	{
		PlayerInputComponent->BindKey(Key, IE_Pressed, this, &ASkyStackDirector::RequestPrimary);
	}
	PlayerInputComponent->BindTouch(IE_Pressed, this, &ASkyStackDirector::OnTouchPressed);

	PlayerInputComponent->BindKey(EKeys::R, IE_Pressed, this, &ASkyStackDirector::RequestRetry);
	PlayerInputComponent->BindKey(EKeys::Gamepad_FaceButton_Left, IE_Pressed, this, &ASkyStackDirector::RequestRetry);

	PlayerInputComponent->BindKey(EKeys::Escape, IE_Pressed, this, &ASkyStackDirector::OnBack);
	PlayerInputComponent->BindKey(EKeys::Tab, IE_Pressed, this, &ASkyStackDirector::OnBack);
	PlayerInputComponent->BindKey(EKeys::Gamepad_FaceButton_Right, IE_Pressed, this, &ASkyStackDirector::OnBack);

	PlayerInputComponent->BindKey(EKeys::D, IE_Pressed, this, &ASkyStackDirector::OnSelectDaily);
	PlayerInputComponent->BindKey(EKeys::E, IE_Pressed, this, &ASkyStackDirector::OnSelectEndless);
	for (const FKey& Key : { EKeys::Left, EKeys::Right, EKeys::Up, EKeys::Down, EKeys::Gamepad_DPad_Left, EKeys::Gamepad_DPad_Right })
	{
		PlayerInputComponent->BindKey(Key, IE_Pressed, this, &ASkyStackDirector::OnToggleMode);
	}

	PlayerInputComponent->BindKey(EKeys::C, IE_Pressed, this, &ASkyStackDirector::RequestShare);
	PlayerInputComponent->BindKey(EKeys::Gamepad_FaceButton_Top, IE_Pressed, this, &ASkyStackDirector::RequestShare);
	PlayerInputComponent->BindKey(EKeys::M, IE_Pressed, this, &ASkyStackDirector::RequestToggleMute);
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

void ASkyStackDirector::RequestPrimary()
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
	RequestPrimary();
}

void ASkyStackDirector::RequestRetry()
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
	RequestMenu();
}

void ASkyStackDirector::RequestMenu()
{
	if (State != EStackState::Title)
	{
		Synth->PlayClick();
		EnterTitle();
	}
}

void ASkyStackDirector::RequestMode(EStackMode NewMode)
{
	if (State == EStackState::Title && Mode != NewMode)
	{
		Mode = NewMode;
		Synth->PlayClick();
		RefreshBestMarker();
	}
}

void ASkyStackDirector::RequestShare()
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

void ASkyStackDirector::RequestToggleMute()
{
	Save->bMuted = !Save->bMuted;
	Synth->SetMuted(Save->bMuted);
	SaveProgress();
	AddToast(Save->bMuted ? TEXT("SOUND OFF") : TEXT("SOUND ON"), FLinearColor::White, 34.f, 0.8f);
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
	Floor = 0;
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

	// Daily runs share a seed, so everyone gets the same palette, speeds and twists that day.
	const int32 Seed = Mode == EStackMode::Daily ? DailyId * 7919 + 1337 : FMath::Rand();
	Rng.Initialize(Seed);
	PaletteIndex = Rng.RandRange(0, NumPalettes - 1);

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
		FLinearColor PillarColor = FloorColor(0) * 0.3f;
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
		AddToast(TEXT("RUSH"), FLinearColor(1.f, 0.35f, 0.3f), 52.f, 0.9f);
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
	FVector CutPoint = FVector::ZeroVector;

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
		CutPoint = FVector(ChipCenter, Z);
		const FVector2D CutOffset = bSliderAlongX ? FVector2D(-Side * Error * 0.5, 0.0) : FVector2D(0.0, -Side * Error * 0.5);
		CutPoint += FVector(CutOffset, 0.0);
		if (ASkyStackBlock* Chip = SpawnBlock(FVector(ChipCenter, Z), FVector(ChipSize, BlockHeight), Slider->GetColor()))
		{
			const FVector Push = bSliderAlongX ? FVector(Side, 0.0, 0.0) : FVector(0.0, Side, 0.0);
			Chip->MakeDebris(Push * 140.0 + FVector(0.0, 0.0, 60.0), RandomSpin(160.f));
			Chip->SetLifeSpan(6.f);
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
	const FLinearColor BlockColor = Placed->GetColor();
	switch (Grade)
	{
	case EDropGrade::Perfect:
	{
		Synth->PlayPerfect(Combo);
		Placed->Flash(4.f + FMath::Min(Combo, 8) * 0.5f, 0.6f);
		SpawnPerfectHalo(FVector(NewCenter, Z), NewSize);
		BurstEdgeSparks(TopMiddle, NewSize, BlockColor * 1.5f + FLinearColor(0.3f, 0.3f, 0.3f), 18 + FMath::Min(Combo, 10) * 4, 260.f + Combo * 25.f);
		AddTrauma(0.12f);
		FovKick = -1.2f;
		FringePulse = FMath::Max(FringePulse, 0.5f);
		const FString Label = Combo > 1 ? FString::Printf(TEXT("PERFECT  x%d"), Combo) : FString(TEXT("PERFECT"));
		AddToast(Label, FLinearColor(1.f, 0.85f, 0.35f), 56.f + FMath::Min(Combo, 10) * 4.f);
		if (Combo >= ComboToGrow && (TopSize.X < BaseSize || TopSize.Y < BaseSize))
		{
			// Streaks earn width back.
			TopSize.X = FMath::Min(TopSize.X + GrowAmount, BaseSize);
			TopSize.Y = FMath::Min(TopSize.Y + GrowAmount, BaseSize);
			Placed->TweenSize(FVector(TopSize, BlockHeight), 0.3f);
			Synth->PlayGrow();
			AddToast(TEXT("+ WIDER"), FLinearColor(0.45f, 1.f, 0.75f), 36.f, 0.9f);
		}
		break;
	}
	case EDropGrade::Good:
		Synth->PlayChop();
		BurstSparks(CutPoint, BlockColor, 14, 220.f, 7.f, 0.7f, 900.f);
		AddTrauma(0.18f);
		break;
	case EDropGrade::Clutch:
		Synth->PlayChop();
		Synth->PlayClutch();
		BurstSparks(CutPoint, FLinearColor(1.f, 0.45f, 0.15f), 40, 420.f, 9.f, 0.9f, 700.f);
		Placed->Flash(3.f, 0.4f);
		AddTrauma(0.4f);
		FovKick = 3.f;
		FringePulse = 1.f;
		StartSlowMo(0.3f, 0.45f);
		AddToast(TEXT("CLUTCH"), FLinearColor(1.f, 0.45f, 0.25f), 88.f, 1.2f);
		break;
	}

	const int32 NewZone = ZoneForFloor(Floor);
	if (NewZone != Zone)
	{
		Zone = NewZone;
		AddToast(GetZoneName(), FLinearColor::White, 72.f, 2.4f);
		Synth->PlayZone();
		AddTrauma(0.2f);
		BurstSparks(TopMiddle, FLinearColor(1.f, 0.95f, 0.8f), 70, 700.f, 10.f, 1.6f, 300.f);
	}

	if (!bPassedBest && BestAtStart > 0 && Floor > BestAtStart)
	{
		bPassedBest = true;
		AddToast(TEXT("NEW RECORD"), FLinearColor(1.f, 0.75f, 0.2f), 84.f, 1.8f);
		Synth->PlayRecord();
		BurstSparks(TopMiddle, FLinearColor(1.f, 0.72f, 0.2f), 90, 800.f, 11.f, 1.8f, 400.f);
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
		BurstSparks(Slider->GetActorLocation(), Slider->GetColor(), 24, 300.f, 8.f, 0.8f, 900.f);
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
		if (Index % 3 == 0)
		{
			BurstSparks(Block->GetActorLocation(), Block->GetColor(), 6, 350.f, 8.f, 1.2f, 600.f);
		}
	}

	if (Count > 0)
	{
		Synth->PlayCollapse();
		AddTrauma(0.6f);
		AddToast(TEXT("TIMBER"), FLinearColor(1.f, 0.6f, 0.35f), 96.f, 1.6f);
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

	// A showcase tower for the title screen to orbit.
	PaletteIndex = FMath::RandRange(0, NumPalettes - 1);
	FVector2D Size(BaseSize, BaseSize);
	FVector2D Center = FVector2D::ZeroVector;
	constexpr int32 DemoFloors = 16;
	for (int32 Index = 1; Index <= DemoFloors; ++Index)
	{
		const double Trim = FMath::FRandRange(0.0, 14.0);
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

	if (Pillar)
	{
		FLinearColor PillarColor = FloorColor(0) * 0.3f;
		PillarColor.A = 1.f;
		Pillar->SetColor(PillarColor);
	}
}

void ASkyStackDirector::BuildWorld()
{
	using namespace SkyStackTuning;

	// The pillar reaches from the tower base down to the (sinking) planet surface.
	Pillar = SpawnBlock(FVector(0.0, 0.0, -1500.0), FVector(BaseSize, BaseSize, 3000.0), FLinearColor(0.05f, 0.05f, 0.07f));

	UMaterialInterface* SparkMaterial = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/SkyStack/M_SkySpark.M_SkySpark"), nullptr, LOAD_NoWarn | LOAD_Quiet);
	if (SparkMaterial)
	{
		SparkMesh->SetMaterial(0, SparkMaterial);
		StarMaterial = UMaterialInstanceDynamic::Create(SparkMaterial, this);
		StarMesh->SetMaterial(0, StarMaterial);
	}
	else
	{
		UE_LOG(LogTemp, Warning, TEXT("SkyStack: M_SkySpark not found. Open the project in the editor once so init_unreal.py can build it."));
		StarMesh->SetVisibility(false);
	}

	SparkPoolSize = SparkPool;
	TArray<FTransform> Hidden;
	Hidden.Init(HiddenInstance(), SparkPoolSize);
	SparkMesh->AddInstances(Hidden, false, true);

	BuildStars();
}

void ASkyStackDirector::BuildStars()
{
	// A shell of glowing points kept centred on the camera: the night sky and the view from orbit.
	FRandomStream StarRng(90210);
	constexpr double Radius = 1400000.0;
	TArray<FTransform> Transforms;
	Transforms.Reserve(SkyStackTuning::StarCount);
	for (int32 Index = 0; Index < SkyStackTuning::StarCount; ++Index)
	{
		const double Yaw = StarRng.FRandRange(0.f, 360.f);
		const double SinElevation = StarRng.FRandRange(-0.08f, 1.f);
		const double Elevation = FMath::RadiansToDegrees(FMath::Asin(SinElevation));
		const FVector Dir = FRotator(Elevation, Yaw, 0.0).Vector();
		const double Size = StarRng.FRandRange(900.f, 3000.f) * (StarRng.FRand() < 0.05f ? 2.0 : 1.0);
		Transforms.Add(FTransform(FRotator(StarRng.FRandRange(0.f, 90.f), StarRng.FRandRange(0.f, 90.f), 0.f), Dir * Radius, FVector(Size / 100.0)));
	}
	StarMesh->AddInstances(Transforms, false, false);

	for (int32 Index = 0; Index < SkyStackTuning::StarCount; ++Index)
	{
		const float Tint = StarRng.FRand();
		const FLinearColor Color = Tint < 0.15f ? FLinearColor(1.f, 0.85f, 0.6f) : (Tint < 0.35f ? FLinearColor(0.7f, 0.8f, 1.f) : FLinearColor::White);
		StarMesh->SetCustomDataValue(Index, 0, Color.R);
		StarMesh->SetCustomDataValue(Index, 1, Color.G);
		StarMesh->SetCustomDataValue(Index, 2, Color.B);
		StarMesh->SetCustomDataValue(Index, 3, StarRng.FRandRange(0.35f, 1.f));
	}
	StarMesh->MarkRenderStateDirty();
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

	// A glowing gold ring hanging at your record height: the thing you're climbing toward.
	const double Z = Best * BlockHeight;
	const double S = BaseSize + 110.0;
	constexpr double T = 6.0;
	const FVector Bars[][2] =
	{
		{ FVector(0.0, S * 0.5, Z), FVector(S + T, T, T) },
		{ FVector(0.0, -S * 0.5, Z), FVector(S + T, T, T) },
		{ FVector(S * 0.5, 0.0, Z), FVector(T, S + T, T) },
		{ FVector(-S * 0.5, 0.0, Z), FVector(T, S + T, T) },
	};
	for (const auto& Bar : Bars)
	{
		if (ASkyStackBlock* Block = SpawnBlock(Bar[0], Bar[1], FLinearColor(1.f, 0.62f, 0.12f)))
		{
			Block->UseGlowMaterial(10.f);
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

	if (!bConfiguredController)
	{
		if (APlayerController* PC = Cast<APlayerController>(GetController()))
		{
			// Keep the cursor for the UI buttons while clicks on the world still drop blocks.
			FInputModeGameAndUI InputMode;
			InputMode.SetHideCursorDuringCapture(false);
			InputMode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
			PC->SetInputMode(InputMode);
			PC->SetShowMouseCursor(true);
			bConfiguredController = true;
		}
	}

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

	UpdateSparks(DeltaSeconds);
	UpdateSky(RealDt);
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

	const FZoneInfo& ZoneInfo = GZones[FMath::Clamp(Zone, 0, NumZones - 1)];
	FVector Goal;
	float GoalDist;
	float GoalPitch = ZoneInfo.CameraPitch;
	switch (State)
	{
	case EStackState::Title:
		Goal = FVector(0.0, 0.0, RunHeight * 0.6 + 40.0);
		GoalDist = 1500.f;
		GoalPitch = -12.f;
		CamYaw += 7.f * RealDt;
		break;
	case EStackState::Playing:
		Goal = FVector(TopCenter * 0.5, Floor * BlockHeight + 50.0);
		GoalDist = 1250.f;
		CamYaw += FMath::FindDeltaAngleDegrees(CamYaw, 225.f) * FMath::Min(1.f, RealDt * 2.5f);
		break;
	default:
		// Pull back and orbit so the whole collapse is in frame. Made for clips.
		Goal = FVector(0.0, 0.0, RunHeight * 0.45);
		GoalDist = 1300.f + static_cast<float>(RunHeight) * 1.05f;
		GoalPitch = FMath::Max(GoalPitch, -18.f);
		CamYaw += 9.f * RealDt;
		break;
	}
	CamYaw = FMath::Fmod(CamYaw, 360.f);

	CamTarget = FMath::VInterpTo(CamTarget, Goal, RealDt, 3.5f);
	CamDist = FMath::FInterpTo(CamDist, GoalDist, RealDt, 2.f);
	CamPitch = FMath::FInterpTo(CamPitch, GoalPitch, RealDt, 1.2f);

	// A slow handheld drift keeps the frame alive even when nothing is happening.
	const float Breath = FMath::Sin(RealTime * 0.7f) * 0.6f;
	const FRotator ViewRotation(CamPitch + Breath * 0.4f, CamYaw + Breath, 0.f);
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

	FovKick = FMath::FInterpTo(FovKick, 0.f, RealDt, 5.f);
	Camera->SetFieldOfView(CameraFov + FovKick);
	Camera->PostProcessSettings.DepthOfFieldFocalDistance = CamDist;
}

void ASkyStackDirector::UpdateSky(float RealDt)
{
	using namespace SkyStackTuning;

	const FZoneInfo& Target = GZones[FMath::Clamp(Zone, 0, NumZones - 1)];
	const float Blend = FMath::Clamp(RealDt * 0.8f, 0.f, 1.f);

	SunElevation = FMath::Lerp(SunElevation, Target.SunElevation, Blend);
	SunYaw += FMath::FindDeltaAngleDegrees(SunYaw, Target.SunYaw) * Blend;
	SunColor = FMath::Lerp(SunColor, Target.SunColor, Blend);
	MoonIntensity = FMath::Lerp(MoonIntensity, Target.MoonIntensity, Blend);
	EdgeGlow = FMath::Lerp(EdgeGlow, Target.EdgeGlow, Blend);
	StarFade = FMath::Lerp(StarFade, Target.StarFade, Blend);
	ExposureBias = FMath::Lerp(ExposureBias, Target.ExposureBias, Blend);

	Sun->SetWorldRotation(FRotator(-SunElevation, SunYaw, 0.f));
	Sun->SetLightColor(SunColor);
	Moon->SetIntensity(MoonIntensity);

	// Altitude eases in log space so the drop from orbit back to the sea feels like a dive.
	const double TargetAltitude = State == EStackState::Title ? StartAltitudeMeters : AltitudeMetersForFloor(Floor);
	const double LogNow = FMath::Loge(AltitudeMeters + 1.0);
	const double LogTarget = FMath::Loge(TargetAltitude + 1.0);
	AltitudeMeters = FMath::Exp(FMath::Lerp(LogNow, LogTarget, FMath::Clamp(static_cast<double>(RealDt) * 1.8, 0.0, 1.0))) - 1.0;

	if (FMath::Abs(AltitudeMeters - AppliedAltitudeMeters) > FMath::Max(0.25, AltitudeMeters * 0.001))
	{
		AppliedAltitudeMeters = AltitudeMeters;
		const double GroundZ = -AltitudeMeters * 100.0;
		Atmosphere->SetWorldLocation(FVector(0.0, 0.0, GroundZ));
		Atmosphere->MarkRenderStateDirty();
		CloudLayer->SetWorldLocation(FVector(0.0, 0.0, GroundZ));
		CloudLayer->MarkRenderStateDirty();
		Fog->SetWorldLocation(FVector(0.0, 0.0, GroundZ));
		if (Pillar)
		{
			const double Length = FMath::Min(-GroundZ, 2000000.0) + 2000.0;
			Pillar->SetBlockSize(FVector(BaseSize, BaseSize, Length));
			Pillar->SetActorLocation(FVector(0.0, 0.0, -Length * 0.5));
		}
	}

	// At night the tower's seams light up like neon.
	if (FMath::Abs(EdgeGlow - AppliedEdgeGlow) > 0.02f)
	{
		AppliedEdgeGlow = EdgeGlow;
		for (ASkyStackBlock* Block : Tower)
		{
			if (IsValid(Block))
			{
				Block->SetEdgeGlow(EdgeGlow);
			}
		}
		if (Slider)
		{
			Slider->SetEdgeGlow(EdgeGlow);
		}
		if (Pillar)
		{
			Pillar->SetEdgeGlow(EdgeGlow * 0.5f);
		}
	}

	StarMesh->SetWorldLocation(Camera->GetComponentLocation());
	if (StarMaterial)
	{
		StarMaterial->SetScalarParameterValue(TEXT("Fade"), StarFade);
		StarMesh->SetVisibility(StarFade > 0.01f);
	}

	FPostProcessSettings& Settings = PostFX->Settings;
	FringePulse = FMath::Max(0.f, FringePulse - RealDt * 2.5f);
	Settings.SceneFringeIntensity = 0.3f + FringePulse * 3.f;
	Settings.AutoExposureBias = ExposureBias;

	// Thin tower: close the vignette and warm the image toward red.
	const float Danger = GetDanger() * (0.75f + 0.25f * FMath::Sin(RealTime * 9.f));
	Settings.VignetteIntensity = 0.35f + Danger * 0.5f;
	Settings.SceneColorTint = FMath::Lerp(FLinearColor::White, FLinearColor(1.f, 0.72f, 0.7f), Danger);
}

void ASkyStackDirector::UpdateSparks(float GameDt)
{
	for (int32 Index = Sparks.Num() - 1; Index >= 0; --Index)
	{
		FStackSpark& Spark = Sparks[Index];
		Spark.Life -= GameDt;
		if (Spark.Life <= 0.f)
		{
			Sparks.RemoveAtSwap(Index);
			continue;
		}
		Spark.Velocity *= FMath::Exp(-Spark.Drag * GameDt);
		Spark.Velocity.Z -= Spark.Gravity * GameDt;
		Spark.Position += Spark.Velocity * GameDt;
	}

	if (SparkPoolSize == 0)
	{
		return;
	}

	TArray<FTransform> Transforms;
	Transforms.SetNum(SparkPoolSize);
	for (int32 Index = 0; Index < SparkPoolSize; ++Index)
	{
		if (!Sparks.IsValidIndex(Index))
		{
			Transforms[Index] = HiddenInstance();
			continue;
		}
		const FStackSpark& Spark = Sparks[Index];
		const float Alpha = Spark.Life / Spark.MaxLife;
		const double Speed = Spark.Velocity.Size();
		const FVector Dir = Speed > 1.0 ? Spark.Velocity / Speed : FVector::UpVector;
		// Stretch along velocity so fast sparks read as streaks.
		const double Length = Spark.Size * (1.0 + Speed * 0.012);
		const double Thickness = Spark.Size * 0.35 * (0.3 + 0.7 * Alpha);
		Transforms[Index] = FTransform(Dir.Rotation(), Spark.Position, FVector(Length, Thickness, Thickness) / 100.0);
		SparkMesh->SetCustomDataValue(Index, 0, Spark.Color.R);
		SparkMesh->SetCustomDataValue(Index, 1, Spark.Color.G);
		SparkMesh->SetCustomDataValue(Index, 2, Spark.Color.B);
		SparkMesh->SetCustomDataValue(Index, 3, Alpha);
	}
	SparkMesh->BatchUpdateInstancesTransforms(0, Transforms, true, true, true);
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
	if (Toasts.Num() > 3)
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
	// An additive plate inside the block that bursts outward: only its glowing rim is visible.
	ASkyStackBlock* Halo = SpawnBlock(Center, FVector(Footprint + FVector2D(6.0, 6.0), SkyStackTuning::BlockHeight * 0.5), FLinearColor(1.f, 0.95f, 0.85f));
	if (Halo)
	{
		Halo->UseGlowMaterial(5.f);
		Halo->TweenSize(FVector(Footprint + FVector2D(170.0, 170.0), 2.0), 0.5f, true);
	}
}

void ASkyStackDirector::BurstEdgeSparks(const FVector& Center, const FVector2D& Footprint, const FLinearColor& Color, int32 Count, float Speed)
{
	// Sparks fly off the rim of the block that just landed.
	for (int32 Index = 0; Index < Count; ++Index)
	{
		const int32 Side = FMath::RandRange(0, 3);
		const double U = FMath::FRandRange(-0.5, 0.5);
		FVector2D Local;
		FVector2D Out;
		switch (Side)
		{
		case 0:  Local = FVector2D(U * Footprint.X, 0.5 * Footprint.Y);  Out = FVector2D(0.0, 1.0);  break;
		case 1:  Local = FVector2D(U * Footprint.X, -0.5 * Footprint.Y); Out = FVector2D(0.0, -1.0); break;
		case 2:  Local = FVector2D(0.5 * Footprint.X, U * Footprint.Y);  Out = FVector2D(1.0, 0.0);  break;
		default: Local = FVector2D(-0.5 * Footprint.X, U * Footprint.Y); Out = FVector2D(-1.0, 0.0); break;
		}
		FStackSpark& Spark = Sparks.AddDefaulted_GetRef();
		Spark.Position = Center + FVector(Local, 0.0);
		Spark.Velocity = FVector(Out * Speed * FMath::FRandRange(0.4, 1.0), Speed * FMath::FRandRange(0.2, 0.9));
		Spark.Color = Color;
		Spark.MaxLife = Spark.Life = FMath::FRandRange(0.4f, 0.9f);
		Spark.Size = FMath::FRandRange(5.f, 10.f);
		Spark.Drag = 2.5f;
		Spark.Gravity = 700.f;
	}
	if (Sparks.Num() > SparkPoolSize)
	{
		Sparks.RemoveAt(0, Sparks.Num() - SparkPoolSize);
	}
}

void ASkyStackDirector::BurstSparks(const FVector& Origin, const FLinearColor& Color, int32 Count, float Speed, float Size, float Life, float Gravity)
{
	for (int32 Index = 0; Index < Count; ++Index)
	{
		FVector Dir = FMath::VRand();
		Dir.Z = FMath::Abs(Dir.Z) * 0.8 + 0.2;
		FStackSpark& Spark = Sparks.AddDefaulted_GetRef();
		Spark.Position = Origin;
		Spark.Velocity = Dir.GetSafeNormal() * Speed * FMath::FRandRange(0.3, 1.0);
		Spark.Color = Color;
		Spark.MaxLife = Spark.Life = Life * FMath::FRandRange(0.6f, 1.f);
		Spark.Size = Size * FMath::FRandRange(0.6f, 1.2f);
		Spark.Drag = 1.8f;
		Spark.Gravity = Gravity;
	}
	if (Sparks.Num() > SparkPoolSize)
	{
		Sparks.RemoveAt(0, Sparks.Num() - SparkPoolSize);
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
		Block->SetEdgeGlow(EdgeGlow);
	}
	return Block;
}

FLinearColor ASkyStackDirector::FloorColor(int32 FloorIndex) const
{
	// Ping-pong through the palette's three stops every ~56 floors.
	const FPaletteInfo& Palette = GPalettes[FMath::Clamp(PaletteIndex, 0, NumPalettes - 1)];
	const float T = FMath::Fmod(FloorIndex / 14.f, 4.f);
	const int32 Segment = FMath::Min(static_cast<int32>(T), 3);
	const float Local = T - Segment;
	static const int32 From[4] = { 0, 1, 2, 1 };
	static const int32 To[4] = { 1, 2, 1, 0 };
	return FMath::Lerp(HexToLinear(Palette.Stops[From[Segment]]), HexToLinear(Palette.Stops[To[Segment]]), Local);
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

FString ASkyStackDirector::GetPaletteName() const
{
	return GPalettes[FMath::Clamp(PaletteIndex, 0, NumPalettes - 1)].Name;
}

double ASkyStackDirector::AltitudeMetersForFloor(double FloorValue)
{
	using namespace SkyStackTuning;
	// Linear through the weather, then exponential into space: 6 km at floor 100, orbit by ~140.
	if (FloorValue <= 100.0)
	{
		return StartAltitudeMeters + FloorValue * 57.0;
	}
	return FMath::Min((StartAltitudeMeters + 5700.0) * FMath::Exp((FloorValue - 100.0) / 14.0), 140000.0);
}

FString ASkyStackDirector::GetAltitudeText() const
{
	if (AltitudeMeters < 10000.0)
	{
		return FString::Printf(TEXT("%s m"), *FText::AsNumber(static_cast<int32>(FMath::RoundToDouble(AltitudeMeters))).ToString());
	}
	return FString::Printf(TEXT("%.1f km"), AltitudeMeters / 1000.0);
}

FString ASkyStackDirector::GetTaunt() const
{
	if (Floor == 0)   return TEXT("The first block is free. You missed it anyway.");
	if (Floor < 5)    return TEXT("Gravity 1, you 0.");
	if (Floor < 10)   return TEXT("Warming up. Surely.");
	if (Floor < 20)   return TEXT("Mid tower energy.");
	if (Floor < 40)   return TEXT("Okay, architect.");
	if (Floor < 60)   return TEXT("Above the clouds. Your friends are not.");
	if (Floor < 80)   return TEXT("Built different.");
	if (Floor < 100)  return TEXT("The stars are watching.");
	if (Floor < 120)  return TEXT("Airliners are below you.");
	return TEXT("Touch grass. From orbit.");
}

FString ASkyStackDirector::BuildShareText() const
{
	const double FinalAltitude = AltitudeMetersForFloor(Floor);
	const FString Altitude = FinalAltitude < 10000.0
		? FString::Printf(TEXT("%d m"), static_cast<int32>(FMath::RoundToDouble(FinalAltitude)))
		: FString::Printf(TEXT("%.1f km"), FinalAltitude / 1000.0);
	FString Out = Mode == EStackMode::Daily
		? FString::Printf(TEXT("SKYSTACK Daily #%d: %d floors, %s "), DailyId, Floor, *Altitude)
		: FString::Printf(TEXT("SKYSTACK Endless: %d floors, %s "), Floor, *Altitude);
	AppendCodepoint(Out, 0x1F680); // rocket
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
