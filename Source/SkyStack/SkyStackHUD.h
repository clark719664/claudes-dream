#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "SkyStackHUD.generated.h"

class ASkyStackDirector;
class UFont;

/**
 * All of SkyStack's UI, drawn straight onto the canvas each frame: the animated title screen,
 * the in-run score, callouts and danger vignette, and the screenshot-ready game over card.
 */
UCLASS()
class SKYSTACK_API ASkyStackHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

private:
	void DrawTitle(const ASkyStackDirector& Director);
	void DrawPlaying(const ASkyStackDirector& Director);
	void DrawGameOver(const ASkyStackDirector& Director);
	void DrawToasts(const ASkyStackDirector& Director);
	void DrawModeCard(const ASkyStackDirector& Director, bool bDaily, float CenterX, float CenterY);
	void DrawRunGrid(const ASkyStackDirector& Director, float CenterX, float TopY, float Alpha);

	/** Draws text whose cap height is roughly Px at 1080p; AlignX 0 = left, 0.5 = centre, 1 = right. */
	void DrawLabel(const FString& Text, float X, float Y, float Px, const FLinearColor& Color, float AlignX = 0.5f);
	FVector2D MeasureLabel(const FString& Text, float Px) const;
	void DrawFrame(float X, float Y, float W, float H, float Thickness, const FLinearColor& Color);

	UPROPERTY()
	TObjectPtr<UFont> Font;

	float ScreenW = 1920.f;
	float ScreenH = 1080.f;
	float UI = 1.f;
};
