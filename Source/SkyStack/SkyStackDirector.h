#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "InputCoreTypes.h"
#include "SkyStackDirector.generated.h"

class ASkyStackBlock;
class UAudioComponent;
class UCameraComponent;
class UDirectionalLightComponent;
class UExponentialHeightFogComponent;
class UPostProcessComponent;
class USkyStackSave;
class USkySynth;

enum class EStackState : uint8
{
	Title,
	Playing,
	Collapsing,
	GameOver
};

enum class EStackMode : uint8
{
	Daily,
	Endless
};

enum class EDropGrade : uint8
{
	Perfect,
	Good,
	Clutch
};

/** Floating callout text ("PERFECT x4", "CLUTCH!", zone names...). */
struct FStackToast
{
	FString Text;
	FLinearColor Color = FLinearColor::White;
	float Size = 64.f;
	float Age = 0.f;
	float Life = 1.1f;
};

/**
 * The whole game lives here. The director is the player's pawn: it owns the camera, lights,
 * fog, post-processing and synth, builds the world out of ASkyStackBlocks, reads input and
 * runs the stacking rules. ASkyStackHUD draws the UI from its state.
 */
UCLASS()
class SKYSTACK_API ASkyStackDirector : public APawn
{
	GENERATED_BODY()

	friend class ASkyStackHUD;

public:
	ASkyStackDirector();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

private:
	// Input
	void OnPrimary();
	void OnTouchPressed(ETouchIndex::Type FingerIndex, FVector Location);
	void OnRetry();
	void OnBack();
	void OnSelectDaily();
	void OnSelectEndless();
	void OnToggleMode();
	void OnCopyShare();
	void OnToggleMute();

	// Flow
	void EnterTitle();
	void StartRun();
	void SpawnSlider();
	void DropSlider();
	void MissAndEndRun();
	void CollapseTower();
	void ClearTower();
	void BuildDemoTower();
	void BuildEnvironment();
	void RefreshBestMarker();

	// Per frame
	void UpdateSlider(float GameDt);
	void UpdateCamera(float RealDt);
	void UpdateAtmosphere(float RealDt);
	void UpdateClouds(float GameDt);
	void UpdateToasts(float RealDt);
	void UpdateMusic();

	// Juice
	void AddToast(const FString& Text, const FLinearColor& Color, float Size = 64.f, float Life = 1.1f);
	void AddTrauma(float Amount);
	void StartSlowMo(float Dilation, float RealDuration);
	void SpawnPerfectHalo(const FVector& Center, const FVector2D& Footprint);
	void SpawnConfetti(const FVector& Origin, int32 Count);

	// Helpers
	ASkyStackBlock* SpawnBlock(const FVector& Center, const FVector& Size, const FLinearColor& Color);
	FVector GetSliderLocation() const;
	FLinearColor FloorColor(int32 FloorIndex) const;
	int32 GetBest() const;
	int32 ZoneForFloor(int32 FloorIndex) const;
	FString GetZoneName() const;
	FString GetTaunt() const;
	FString BuildShareText() const;
	FVector GetBestMarkerLocation() const;
	float GetDanger() const;
	void SaveProgress();

	// Components
	UPROPERTY(VisibleAnywhere, Category = "SkyStack")
	TObjectPtr<USceneComponent> Root;

	UPROPERTY(VisibleAnywhere, Category = "SkyStack")
	TObjectPtr<UCameraComponent> Camera;

	UPROPERTY(VisibleAnywhere, Category = "SkyStack")
	TObjectPtr<UDirectionalLightComponent> KeyLight;

	UPROPERTY(VisibleAnywhere, Category = "SkyStack")
	TObjectPtr<UDirectionalLightComponent> FillLight;

	UPROPERTY(VisibleAnywhere, Category = "SkyStack")
	TObjectPtr<UExponentialHeightFogComponent> Fog;

	UPROPERTY(VisibleAnywhere, Category = "SkyStack")
	TObjectPtr<UPostProcessComponent> PostFX;

	UPROPERTY(VisibleAnywhere, Category = "SkyStack")
	TObjectPtr<UAudioComponent> Audio;

	UPROPERTY()
	TObjectPtr<USkySynth> Synth;

	UPROPERTY()
	TObjectPtr<USkyStackSave> Save;

	// World
	UPROPERTY()
	TObjectPtr<ASkyStackBlock> Slider;

	UPROPERTY()
	TObjectPtr<ASkyStackBlock> Pillar;

	UPROPERTY()
	TArray<TObjectPtr<ASkyStackBlock>> Tower;

	UPROPERTY()
	TArray<TObjectPtr<ASkyStackBlock>> Clouds;

	UPROPERTY()
	TArray<TObjectPtr<ASkyStackBlock>> Backdrop;

	UPROPERTY()
	TArray<TObjectPtr<ASkyStackBlock>> BestMarker;

	TArray<TWeakObjectPtr<ASkyStackBlock>> Debris;
	TArray<float> CloudSpeeds;

	// Run state
	EStackState State = EStackState::Title;
	EStackMode Mode = EStackMode::Daily;
	FRandomStream Rng;
	int32 DailyId = 0;
	int32 Floor = 0;
	int32 Combo = 0;
	int32 MaxCombo = 0;
	int32 Perfects = 0;
	int32 BestAtStart = 0;
	int32 Zone = 0;
	bool bNewBest = false;
	bool bPassedBest = false;
	bool bCollapsed = false;
	TArray<EDropGrade> RunLog;
	FVector2D TopCenter = FVector2D::ZeroVector;
	FVector2D TopSize = FVector2D::ZeroVector;
	double RunHeight = 0.0;
	float HueBase = 0.f;

	// Moving block
	bool bSliderAlongX = true;
	bool bSliderWobble = false;
	double SliderOffset = 0.0;
	float SliderDir = 1.f;
	float SliderSpeed = 300.f;

	// Presentation
	float RealTime = 0.f;
	float StateTime = 0.f;
	float LastPrimaryTime = -1.f;
	float SlowMoTimer = 0.f;
	float Trauma = 0.f;
	float ScorePop = 0.f;
	float FringePulse = 0.f;
	float CopiedTimer = 0.f;
	FVector CamTarget = FVector::ZeroVector;
	float CamDist = 1400.f;
	float CamYaw = 225.f;
	float CamPitch = -24.f;
	FLinearColor FogColor = FLinearColor::Black;
	FLinearColor SunColor = FLinearColor::White;
	float SunIntensity = 4.f;
	float SunPitch = -50.f;
	TArray<FStackToast> Toasts;
};
