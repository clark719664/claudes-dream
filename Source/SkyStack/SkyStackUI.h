#pragma once

#include "CoreMinimal.h"
#include "Styling/SlateBrush.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"

class APlayerController;
class ASkyStackDirector;
class SUniformGridPanel;

/**
 * SkyStack's whole interface as one Slate widget layered over the viewport: title screen with
 * mode cards, the in-run HUD (score, combo meter, altitude, record chip, callouts) and the
 * frosted game-over card with the run grid and share/retry buttons.
 *
 * Typography uses the bundled Unbounded (display) and Manrope (UI) fonts from Content/Fonts.
 */
class SSkyStackOverlay : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SSkyStackOverlay) {}
		SLATE_ARGUMENT(TWeakObjectPtr<APlayerController>, Owner)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

private:
	ASkyStackDirector* GetDirector() const;

	TSharedRef<SWidget> BuildTitle();
	TSharedRef<SWidget> BuildModeCard(bool bDaily);
	TSharedRef<SWidget> BuildPlaying();
	TSharedRef<SWidget> BuildToasts();
	TSharedRef<SWidget> BuildGameOver();
	TSharedRef<SWidget> BuildStat(TFunction<FText()> Value, const FText& Label);
	TSharedRef<SWidget> BuildButton(const FText& Label, const FText& Hint, bool bPrimary, TFunction<void()> OnClick);
	TSharedRef<SWidget> BuildChip(TSharedRef<SWidget> Content);
	void RebuildRunGrid();

	TWeakObjectPtr<APlayerController> Owner;
	TSharedPtr<SUniformGridPanel> RunGrid;
	bool bRunGridBuilt = false;

	FSlateBrush NoBrush;
	FSlateBrush SolidBrush;
	FSlateBrush GlassBrush;
	FSlateBrush CardBrush;
	FSlateBrush CardSelectedBrush;
	FSlateBrush ChipBrush;
	FSlateBrush CellBrush;
	FSlateBrush MeterTrackBrush;
	FSlateBrush MeterFillBrush;
	FButtonStyle PrimaryButton;
	FButtonStyle GhostButton;
	FButtonStyle CardButton;
};
