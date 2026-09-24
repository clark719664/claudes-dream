#include "SkyStackUI.h"

#include "SkyStackDirector.h"
#include "SkyStackSave.h"

#include "Brushes/SlateColorBrush.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "GameFramework/PlayerController.h"
#include "Misc/Paths.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Layout/SBackgroundBlur.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SSpacer.h"
#include "Widgets/Layout/SUniformGridPanel.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

#define LOCTEXT_NAMESPACE "SkyStackUI"

namespace SkyUI
{
	enum class EFace : uint8
	{
		Display, // Unbounded Black: numbers and the logo
		Heading, // Unbounded Bold: headlines and buttons
		Label,   // Manrope ExtraBold: labels, chips
		Body     // Manrope SemiBold: sentences
	};

	FSlateFontInfo Font(EFace Face, float Size, int32 LetterSpacing = 0)
	{
		static const FString Dir = FPaths::ProjectContentDir() / TEXT("Fonts");
		static const FString Files[] =
		{
			Dir / TEXT("Unbounded-Black.ttf"),
			Dir / TEXT("Unbounded-Bold.ttf"),
			Dir / TEXT("Manrope-ExtraBold.ttf"),
			Dir / TEXT("Manrope-SemiBold.ttf"),
		};
		static const bool bHaveFonts = FPaths::FileExists(Files[0]) && FPaths::FileExists(Files[2]);

		FSlateFontInfo Info = bHaveFonts
			? FSlateFontInfo(Files[static_cast<int32>(Face)], Size)
			: FCoreStyle::GetDefaultFontStyle(TEXT("Bold"), Size);
		Info.LetterSpacing = LetterSpacing;
		return Info;
	}

	FLinearColor Srgb(uint32 Hex, float Alpha = 1.f)
	{
		FLinearColor Color(FColor((Hex >> 16) & 0xFF, (Hex >> 8) & 0xFF, Hex & 0xFF));
		Color.A = Alpha;
		return Color;
	}

	const FLinearColor Ink(1.f, 1.f, 1.f, 1.f);
	const FLinearColor Dim(1.f, 1.f, 1.f, 0.62f);
	const FLinearColor Faint(1.f, 1.f, 1.f, 0.38f);
	const FLinearColor Shadow(0.f, 0.f, 0.02f, 0.45f);

	FLinearColor Gold() { return Srgb(0xFFC857); }
	FLinearColor Mint() { return Srgb(0x7CFFC4); }
	FLinearColor Sky() { return Srgb(0x8FD8FF); }
	FLinearColor Night() { return Srgb(0x0B0F24); }

	FLinearColor GradeColor(EDropGrade Grade)
	{
		switch (Grade)
		{
		case EDropGrade::Perfect: return Srgb(0x4BE38A);
		case EDropGrade::Good:    return Srgb(0xFFD23F);
		default:                  return Srgb(0xFF8A3D);
		}
	}

	FLinearColor WithAlpha(FLinearColor Color, float Alpha)
	{
		Color.A *= Alpha;
		return Color;
	}

	float EaseOutBack(float T)
	{
		const float C1 = 1.70158f;
		const float C3 = C1 + 1.f;
		const float X = FMath::Clamp(T, 0.f, 1.f) - 1.f;
		return 1.f + C3 * X * X * X + C1 * X * X;
	}

	FSlateRenderTransform Pop(float Scale, float OffsetY = 0.f)
	{
		return FSlateRenderTransform(Scale, FVector2f(0.f, OffsetY));
	}
}

using namespace SkyUI;

void SSkyStackOverlay::Construct(const FArguments& InArgs)
{
	Owner = InArgs._Owner;

	NoBrush.DrawAs = ESlateBrushDrawType::NoDrawType;
	SolidBrush = FSlateColorBrush(FLinearColor::White);
	GlassBrush = FSlateRoundedBoxBrush(Srgb(0x070A1A, 0.62f), 28.f, WithAlpha(Ink, 0.14f), 1.f);
	CardBrush = FSlateRoundedBoxBrush(Srgb(0x070A1A, 0.42f), 22.f, WithAlpha(Ink, 0.12f), 1.f);
	CardSelectedBrush = FSlateRoundedBoxBrush(Srgb(0x0B1030, 0.66f), 22.f, Gold(), 2.f);
	ChipBrush = FSlateRoundedBoxBrush(Srgb(0x070A1A, 0.45f), 18.f, WithAlpha(Ink, 0.1f), 1.f);
	CellBrush = FSlateRoundedBoxBrush(FLinearColor::White, 6.f);
	MeterTrackBrush = FSlateRoundedBoxBrush(WithAlpha(Ink, 0.16f), 4.f);
	MeterFillBrush = FSlateRoundedBoxBrush(FLinearColor::White, 4.f);

	const FSlateBrush PrimaryNormal = FSlateRoundedBoxBrush(Gold(), 30.f);
	const FSlateBrush PrimaryHover = FSlateRoundedBoxBrush(Srgb(0xFFD77E), 30.f);
	const FSlateBrush PrimaryPressed = FSlateRoundedBoxBrush(Srgb(0xE9B040), 30.f);
	PrimaryButton = FButtonStyle()
		.SetNormal(PrimaryNormal).SetHovered(PrimaryHover).SetPressed(PrimaryPressed)
		.SetNormalPadding(FMargin(0.f)).SetPressedPadding(FMargin(0.f, 2.f, 0.f, 0.f));

	const FSlateBrush GhostNormal = FSlateRoundedBoxBrush(WithAlpha(Ink, 0.1f), 30.f, WithAlpha(Ink, 0.22f), 1.f);
	const FSlateBrush GhostHover = FSlateRoundedBoxBrush(WithAlpha(Ink, 0.18f), 30.f, WithAlpha(Ink, 0.4f), 1.f);
	const FSlateBrush GhostPressed = FSlateRoundedBoxBrush(WithAlpha(Ink, 0.08f), 30.f, WithAlpha(Ink, 0.3f), 1.f);
	GhostButton = FButtonStyle()
		.SetNormal(GhostNormal).SetHovered(GhostHover).SetPressed(GhostPressed)
		.SetNormalPadding(FMargin(0.f)).SetPressedPadding(FMargin(0.f, 2.f, 0.f, 0.f));

	// Mode cards draw their own background, so the button itself is invisible.
	CardButton = FButtonStyle()
		.SetNormal(NoBrush).SetHovered(NoBrush).SetPressed(NoBrush)
		.SetNormalPadding(FMargin(0.f)).SetPressedPadding(FMargin(0.f, 2.f, 0.f, 0.f));

	SetVisibility(EVisibility::SelfHitTestInvisible);

	ChildSlot
	[
		SNew(SOverlay)
		.Visibility(EVisibility::SelfHitTestInvisible)
		+ SOverlay::Slot()
		[
			BuildTitle()
		]
		+ SOverlay::Slot()
		[
			BuildPlaying()
		]
		+ SOverlay::Slot()
		[
			BuildGameOver()
		]
		+ SOverlay::Slot()
		[
			BuildToasts()
		]
	];
}

ASkyStackDirector* SSkyStackOverlay::GetDirector() const
{
	if (APlayerController* PC = Owner.Get())
	{
		return Cast<ASkyStackDirector>(PC->GetPawn());
	}
	return nullptr;
}

void SSkyStackOverlay::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);

	const ASkyStackDirector* D = GetDirector();
	const bool bGameOver = D && D->State == EStackState::GameOver;
	if (bGameOver && !bRunGridBuilt)
	{
		RebuildRunGrid();
		bRunGridBuilt = true;
	}
	else if (!bGameOver)
	{
		bRunGridBuilt = false;
	}
}

// ---------------------------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------------------------

TSharedRef<SWidget> SSkyStackOverlay::BuildTitle()
{
	auto Fade = [this]() -> FLinearColor
	{
		const ASkyStackDirector* D = GetDirector();
		return FLinearColor(1.f, 1.f, 1.f, D ? FMath::Clamp(D->StateTime * 1.5f, 0.f, 1.f) : 0.f);
	};

	return SNew(SBorder)
		.BorderImage(&NoBrush)
		.Padding(FMargin(48.f, 56.f, 48.f, 36.f))
		.ColorAndOpacity_Lambda(Fade)
		.Visibility_Lambda([this]()
		{
			const ASkyStackDirector* D = GetDirector();
			return D && D->State == EStackState::Title ? EVisibility::SelfHitTestInvisible : EVisibility::Collapsed;
		})
		[
			SNew(SVerticalBox)

			// Wordmark
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[
				SNew(STextBlock)
				.Text(LOCTEXT("Logo", "SKYSTACK"))
				.Font(Font(EFace::Display, 104.f, 40))
				.ColorAndOpacity(Ink)
				.ShadowOffset(FVector2D(0.f, 6.f))
				.ShadowColorAndOpacity(Shadow)
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(FMargin(0.f, 6.f, 0.f, 0.f))
			[
				SNew(STextBlock)
				.Text(LOCTEXT("Tagline", "STACK TO ORBIT"))
				.Font(Font(EFace::Label, 17.f, 700))
				.ColorAndOpacity(Gold())
				.ShadowOffset(FVector2D(0.f, 2.f))
				.ShadowColorAndOpacity(Shadow)
			]

			+ SVerticalBox::Slot().FillHeight(1.f)
			[
				SNew(SSpacer)
			]

			// Mode cards
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().Padding(FMargin(10.f, 0.f))
				[
					BuildModeCard(true)
				]
				+ SHorizontalBox::Slot().AutoWidth().Padding(FMargin(10.f, 0.f))
				[
					BuildModeCard(false)
				]
			]

			// Play
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(FMargin(0.f, 28.f, 0.f, 0.f))
			[
				SNew(SBox)
				.RenderTransformPivot(FVector2D(0.5f, 0.5f))
				.RenderTransform_Lambda([this]() -> TOptional<FSlateRenderTransform>
				{
					const ASkyStackDirector* D = GetDirector();
					const float Breath = D ? 1.f + 0.03f * FMath::Sin(D->RealTime * 3.f) : 1.f;
					return Pop(Breath);
				})
				[
					BuildButton(LOCTEXT("Play", "PLAY"), LOCTEXT("PlayHint", "SPACE"), true, [this]()
					{
						if (ASkyStackDirector* D = GetDirector())
						{
							D->RequestPrimary();
						}
					})
				]
			]

			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(FMargin(0.f, 26.f, 0.f, 0.f))
			[
				SNew(STextBlock)
				.Font(Font(EFace::Label, 13.f, 250))
				.ColorAndOpacity(Faint)
				.Text_Lambda([this]()
				{
					const ASkyStackDirector* D = GetDirector();
					if (D && D->Save && D->Save->GamesPlayed > 0)
					{
						return FText::Format(LOCTEXT("Lifetime", "{0} RUNS  \u00B7  {1} FLOORS STACKED  \u00B7  M SOUND  \u00B7  ESC QUIT"),
							FText::AsNumber(D->Save->GamesPlayed), FText::AsNumber(D->Save->TotalFloors));
					}
					return LOCTEXT("Controls", "SPACE, CLICK OR TAP TO DROP  \u00B7  D / E MODE  \u00B7  M SOUND  \u00B7  ESC QUIT");
				})
			]
		];
}

TSharedRef<SWidget> SSkyStackOverlay::BuildModeCard(bool bDaily)
{
	auto IsSelected = [this, bDaily]()
	{
		const ASkyStackDirector* D = GetDirector();
		return D && ((D->Mode == EStackMode::Daily) == bDaily);
	};

	const FLinearColor Accent = bDaily ? Gold() : Sky();

	return SNew(SButton)
		.ButtonStyle(&CardButton)
		.IsFocusable(false)
		.ContentPadding(FMargin(0.f))
		.OnClicked_Lambda([this, bDaily]()
		{
			if (ASkyStackDirector* D = GetDirector())
			{
				D->RequestMode(bDaily ? EStackMode::Daily : EStackMode::Endless);
			}
			return FReply::Handled();
		})
		[
			SNew(SBox)
			.WidthOverride(360.f)
			[
				SNew(SBorder)
				.BorderImage_Lambda([this, IsSelected]() { return IsSelected() ? &CardSelectedBrush : &CardBrush; })
				.Padding(FMargin(26.f, 22.f))
				.ColorAndOpacity_Lambda([IsSelected]() { return FLinearColor(1.f, 1.f, 1.f, IsSelected() ? 1.f : 0.6f); })
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(STextBlock)
						.Font(Font(EFace::Label, 13.f, 300))
						.ColorAndOpacity(Accent)
						.Text(bDaily ? LOCTEXT("DailyEyebrow", "SAME TOWER FOR EVERYONE") : LOCTEXT("EndlessEyebrow", "NEW TOWER EVERY RUN"))
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 8.f, 0.f, 0.f))
					[
						SNew(STextBlock)
						.Font(Font(EFace::Heading, 30.f))
						.ColorAndOpacity(Ink)
						.Text_Lambda([this, bDaily]()
						{
							const ASkyStackDirector* D = GetDirector();
							return bDaily && D ? FText::Format(LOCTEXT("DailyTitle", "DAILY #{0}"), FText::AsNumber(D->DailyId)) : (bDaily ? LOCTEXT("DailyShort", "DAILY") : LOCTEXT("EndlessTitle", "ENDLESS"));
						})
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 14.f, 0.f, 0.f))
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().FillWidth(1.f).VAlign(VAlign_Center)
						[
							SNew(STextBlock)
							.Font(Font(EFace::Body, 16.f))
							.ColorAndOpacity(Dim)
							.Text_Lambda([this, bDaily]()
							{
								const ASkyStackDirector* D = GetDirector();
								const USkyStackSave* Save = D ? D->Save.Get() : nullptr;
								if (!Save)
								{
									return FText::GetEmpty();
								}
								const int32 Best = bDaily ? Save->BestDaily : Save->BestEndless;
								if (bDaily && Best == 0)
								{
									return LOCTEXT("DailyFresh", "Not climbed yet today");
								}
								return FText::Format(LOCTEXT("BestLine", "Best  {0} floors"), FText::AsNumber(Best));
							})
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
						[
							SNew(STextBlock)
							.Font(Font(EFace::Label, 13.f, 150))
							.ColorAndOpacity(Srgb(0xFF9F5A))
							.Visibility_Lambda([this, bDaily]()
							{
								const ASkyStackDirector* D = GetDirector();
								const bool bShow = bDaily && D && D->Save && D->Save->DailyStreak > 1 && D->Save->LastDailyPlayed >= D->DailyId - 1;
								return bShow ? EVisibility::HitTestInvisible : EVisibility::Collapsed;
							})
							.Text_Lambda([this]()
							{
								const ASkyStackDirector* D = GetDirector();
								return FText::Format(LOCTEXT("Streak", "{0}-DAY STREAK"), FText::AsNumber(D && D->Save ? D->Save->DailyStreak : 0));
							})
						]
					]
				]
			]
		];
}

// ---------------------------------------------------------------------------------------------
// In-run HUD
// ---------------------------------------------------------------------------------------------

TSharedRef<SWidget> SSkyStackOverlay::BuildChip(TSharedRef<SWidget> Content)
{
	return SNew(SBorder)
		.BorderImage(&ChipBrush)
		.Padding(FMargin(18.f, 10.f))
		[
			Content
		];
}

TSharedRef<SWidget> SSkyStackOverlay::BuildPlaying()
{
	return SNew(SOverlay)
		.Visibility_Lambda([this]()
		{
			const ASkyStackDirector* D = GetDirector();
			return D && (D->State == EStackState::Playing || D->State == EStackState::Collapsing) ? EVisibility::HitTestInvisible : EVisibility::Collapsed;
		})

		// Score
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Top).Padding(FMargin(0.f, 28.f, 0.f, 0.f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[
				SNew(STextBlock)
				.Font(Font(EFace::Display, 132.f))
				.ColorAndOpacity(Ink)
				.ShadowOffset(FVector2D(0.f, 6.f))
				.ShadowColorAndOpacity(Shadow)
				.RenderTransformPivot(FVector2D(0.5f, 0.5f))
				.RenderTransform_Lambda([this]() -> TOptional<FSlateRenderTransform>
				{
					const ASkyStackDirector* D = GetDirector();
					const float P = D ? D->ScorePop : 0.f;
					return Pop(1.f + 0.22f * P * P);
				})
				.Text_Lambda([this]()
				{
					const ASkyStackDirector* D = GetDirector();
					return FText::AsNumber(D ? D->Floor : 0);
				})
			]

			// Combo meter: fills toward the streak that makes the tower wider again.
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(FMargin(0.f, 2.f, 0.f, 0.f))
			[
				SNew(SBox)
				.Visibility_Lambda([this]()
				{
					const ASkyStackDirector* D = GetDirector();
					return D && D->State == EStackState::Playing && D->Combo >= 1 ? EVisibility::HitTestInvisible : EVisibility::Hidden;
				})
				[
					BuildChip(
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
						[
							SNew(STextBlock)
							.Font(Font(EFace::Label, 15.f, 250))
							.ColorAndOpacity(Gold())
							.Text_Lambda([this]()
							{
								const ASkyStackDirector* D = GetDirector();
								return FText::Format(LOCTEXT("Combo", "PERFECT x{0}"), FText::AsNumber(D ? D->Combo : 0));
							})
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(FMargin(14.f, 0.f, 0.f, 0.f))
						[
							SNew(SOverlay)
							+ SOverlay::Slot()
							[
								SNew(SBox).WidthOverride(120.f).HeightOverride(8.f)
								[
									SNew(SImage).Image(&MeterTrackBrush)
								]
							]
							+ SOverlay::Slot().HAlign(HAlign_Left)
							[
								SNew(SBox)
								.HeightOverride(8.f)
								.WidthOverride_Lambda([this]()
								{
									const ASkyStackDirector* D = GetDirector();
									const float Fill = D ? FMath::Clamp(D->Combo / 4.f, 0.f, 1.f) : 0.f;
									return FOptionalSize(FMath::Max(8.f, 120.f * Fill));
								})
								[
									SNew(SImage)
									.Image(&MeterFillBrush)
									.ColorAndOpacity_Lambda([this]()
									{
										const ASkyStackDirector* D = GetDirector();
										return FSlateColor(D && D->Combo >= 4 ? Mint() : Gold());
									})
								]
							]
						]
					)
				]
			]
		]

		// Zone and altitude
		+ SOverlay::Slot().HAlign(HAlign_Left).VAlign(VAlign_Top).Padding(FMargin(36.f, 32.f, 0.f, 0.f))
		[
			BuildChip(
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(STextBlock)
					.Font(Font(EFace::Label, 12.f, 300))
					.ColorAndOpacity(Dim)
					.Text_Lambda([this]()
					{
						const ASkyStackDirector* D = GetDirector();
						return D ? FText::FromString(D->GetZoneName()) : FText::GetEmpty();
					})
				]
				+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 2.f, 0.f, 0.f))
				[
					SNew(STextBlock)
					.Font(Font(EFace::Heading, 24.f))
					.ColorAndOpacity(Ink)
					.Text_Lambda([this]()
					{
						const ASkyStackDirector* D = GetDirector();
						return D ? FText::FromString(D->GetAltitudeText()) : FText::GetEmpty();
					})
				]
			)
		]

		// Record
		+ SOverlay::Slot().HAlign(HAlign_Right).VAlign(VAlign_Top).Padding(FMargin(0.f, 32.f, 36.f, 0.f))
		[
			BuildChip(
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right)
				[
					SNew(STextBlock)
					.Font(Font(EFace::Label, 12.f, 300))
					.ColorAndOpacity(Gold())
					.Text_Lambda([this]()
					{
						const ASkyStackDirector* D = GetDirector();
						if (!D || D->GetBest() == 0)
						{
							return LOCTEXT("FirstClimb", "FIRST CLIMB");
						}
						const int32 ToGo = D->GetBest() - D->Floor + 1;
						return ToGo > 0 ? FText::Format(LOCTEXT("ToBeat", "{0} TO BEAT"), FText::AsNumber(ToGo)) : LOCTEXT("Record", "NEW RECORD");
					})
				]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right).Padding(FMargin(0.f, 2.f, 0.f, 0.f))
				[
					SNew(STextBlock)
					.Font(Font(EFace::Heading, 24.f))
					.ColorAndOpacity(Ink)
					.Text_Lambda([this]()
					{
						const ASkyStackDirector* D = GetDirector();
						return FText::Format(LOCTEXT("BestChip", "BEST {0}"), FText::AsNumber(D ? FMath::Max(D->GetBest(), D->Floor) : 0));
					})
				]
			)
		]

		// First-floor hint
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Bottom).Padding(FMargin(0.f, 0.f, 0.f, 90.f))
		[
			SNew(STextBlock)
			.Font(Font(EFace::Label, 18.f, 400))
			.Text(LOCTEXT("DropHint", "SPACE, CLICK OR TAP TO DROP"))
			.ShadowOffset(FVector2D(0.f, 2.f))
			.ShadowColorAndOpacity(Shadow)
			.Visibility_Lambda([this]()
			{
				const ASkyStackDirector* D = GetDirector();
				return D && D->State == EStackState::Playing && D->Floor < 2 ? EVisibility::HitTestInvisible : EVisibility::Collapsed;
			})
			.ColorAndOpacity_Lambda([this]()
			{
				const ASkyStackDirector* D = GetDirector();
				return FSlateColor(WithAlpha(Ink, D ? 0.55f + 0.45f * FMath::Sin(D->RealTime * 4.f) : 1.f));
			})
		];
}

TSharedRef<SWidget> SSkyStackOverlay::BuildToasts()
{
	TSharedRef<SVerticalBox> Stack = SNew(SVerticalBox);
	for (int32 Slot = 0; Slot < 3; ++Slot)
	{
		// Slot 0 is the newest callout.
		auto Toast = [this, Slot]() -> const FStackToast*
		{
			const ASkyStackDirector* D = GetDirector();
			if (!D)
			{
				return nullptr;
			}
			const int32 Index = D->Toasts.Num() - 1 - Slot;
			return D->Toasts.IsValidIndex(Index) ? &D->Toasts[Index] : nullptr;
		};

		Stack->AddSlot().AutoHeight().HAlign(HAlign_Center).Padding(FMargin(0.f, 4.f))
		[
			SNew(STextBlock)
			.Visibility_Lambda([Toast]() { return Toast() ? EVisibility::HitTestInvisible : EVisibility::Collapsed; })
			.Font_Lambda([Toast]()
			{
				const FStackToast* T = Toast();
				// Snap sizes to a few steps so the font cache stays small.
				const float Size = T ? FMath::RoundToFloat(T->Size / 8.f) * 8.f : 48.f;
				return Font(EFace::Display, Size * 0.8f, 20);
			})
			.Text_Lambda([Toast]() { const FStackToast* T = Toast(); return T ? FText::FromString(T->Text) : FText::GetEmpty(); })
			.ShadowOffset(FVector2D(0.f, 5.f))
			.ShadowColorAndOpacity(Shadow)
			.ColorAndOpacity_Lambda([Toast]()
			{
				const FStackToast* T = Toast();
				if (!T)
				{
					return FSlateColor(FLinearColor::Transparent);
				}
				const float Life01 = T->Age / FMath::Max(T->Life, 0.01f);
				const float Alpha = Life01 < 0.7f ? 1.f : 1.f - (Life01 - 0.7f) / 0.3f;
				return FSlateColor(WithAlpha(T->Color, Alpha));
			})
			.RenderTransformPivot(FVector2D(0.5f, 0.5f))
			.RenderTransform_Lambda([Toast]() -> TOptional<FSlateRenderTransform>
			{
				const FStackToast* T = Toast();
				if (!T)
				{
					return TOptional<FSlateRenderTransform>();
				}
				const float In = EaseOutBack(T->Age / 0.22f);
				return Pop(0.6f + 0.4f * In, -T->Age * 40.f);
			})
		];
	}

	return SNew(SBox)
		.Visibility(EVisibility::HitTestInvisible)
		.HAlign(HAlign_Center)
		.VAlign(VAlign_Top)
		.Padding(FMargin(0.f, 330.f, 0.f, 0.f))
		[
			Stack
		];
}

// ---------------------------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------------------------

TSharedRef<SWidget> SSkyStackOverlay::BuildStat(TFunction<FText()> Value, const FText& Label)
{
	return SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
		[
			SNew(STextBlock)
			.Font(Font(EFace::Heading, 30.f))
			.ColorAndOpacity(Ink)
			.Text_Lambda(MoveTemp(Value))
		]
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(FMargin(0.f, 4.f, 0.f, 0.f))
		[
			SNew(STextBlock)
			.Font(Font(EFace::Label, 12.f, 300))
			.ColorAndOpacity(Dim)
			.Text(Label)
		];
}

TSharedRef<SWidget> SSkyStackOverlay::BuildButton(const FText& Label, const FText& Hint, bool bPrimary, TFunction<void()> OnClick)
{
	const FLinearColor TextColor = bPrimary ? Night() : Ink;
	return SNew(SButton)
		.ButtonStyle(bPrimary ? &PrimaryButton : &GhostButton)
		.IsFocusable(false)
		.ContentPadding(FMargin(bPrimary ? 44.f : 30.f, 16.f))
		.HAlign(HAlign_Center)
		.VAlign(VAlign_Center)
		.OnClicked_Lambda([OnClick]()
		{
			OnClick();
			return FReply::Handled();
		})
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				SNew(STextBlock)
				.Font(Font(EFace::Heading, bPrimary ? 24.f : 18.f, 60))
				.ColorAndOpacity(TextColor)
				.Text(Label)
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(FMargin(12.f, 0.f, 0.f, 0.f))
			[
				SNew(STextBlock)
				.Font(Font(EFace::Label, 12.f, 200))
				.ColorAndOpacity(WithAlpha(TextColor, 0.55f))
				.Text(Hint)
			]
		];
}

TSharedRef<SWidget> SSkyStackOverlay::BuildGameOver()
{
	auto Appear = [this]()
	{
		const ASkyStackDirector* D = GetDirector();
		return D ? FMath::Clamp(D->StateTime * 2.5f, 0.f, 1.f) : 0.f;
	};

	return SNew(SOverlay)
		.Visibility_Lambda([this]()
		{
			const ASkyStackDirector* D = GetDirector();
			return D && D->State == EStackState::GameOver ? EVisibility::SelfHitTestInvisible : EVisibility::Collapsed;
		})

		// Frosted backdrop; clicks fall through to the game (click anywhere to retry).
		+ SOverlay::Slot()
		[
			SNew(SBackgroundBlur)
			.Visibility(EVisibility::HitTestInvisible)
			.BlurStrength_Lambda([Appear]() { return 6.f * Appear(); })
			[
				SNew(SBorder)
				.BorderImage(&SolidBrush)
				.BorderBackgroundColor_Lambda([Appear]() { return FSlateColor(FLinearColor(0.f, 0.005f, 0.02f, 0.4f * Appear())); })
			]
		]

		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
		[
			SNew(SBox)
			.WidthOverride(760.f)
			.RenderTransformPivot(FVector2D(0.5f, 0.5f))
			.RenderTransform_Lambda([Appear]() -> TOptional<FSlateRenderTransform>
			{
				const float A = Appear();
				return Pop(0.94f + 0.06f * EaseOutBack(A), (1.f - A) * 50.f);
			})
			[
				SNew(SBorder)
				.BorderImage(&GlassBrush)
				.Padding(FMargin(48.f, 40.f, 48.f, 36.f))
				.ColorAndOpacity_Lambda([Appear]() { return FLinearColor(1.f, 1.f, 1.f, Appear()); })
				[
					SNew(SVerticalBox)

					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
					[
						SNew(STextBlock)
						.Font(Font(EFace::Heading, 22.f, 400))
						.ColorAndOpacity_Lambda([this]()
						{
							const ASkyStackDirector* D = GetDirector();
							if (D && D->bNewBest)
							{
								// Shimmer between gold and white.
								const float S = 0.5f + 0.5f * FMath::Sin(D->RealTime * 5.f);
								return FSlateColor(FMath::Lerp(Gold(), FLinearColor::White, S * 0.5f));
							}
							return FSlateColor(Dim);
						})
						.Text_Lambda([this]()
						{
							const ASkyStackDirector* D = GetDirector();
							return D && D->bNewBest ? LOCTEXT("NewBest", "NEW BEST") : LOCTEXT("TowerDown", "TOWER DOWN");
						})
					]

					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(FMargin(0.f, 6.f, 0.f, 0.f))
					[
						SNew(STextBlock)
						.Font(Font(EFace::Display, 140.f))
						.ColorAndOpacity(Ink)
						.ShadowOffset(FVector2D(0.f, 6.f))
						.ShadowColorAndOpacity(Shadow)
						.Text_Lambda([this]()
						{
							const ASkyStackDirector* D = GetDirector();
							return FText::AsNumber(D ? D->Floor : 0);
						})
					]

					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
					[
						SNew(STextBlock)
						.Font(Font(EFace::Label, 14.f, 400))
						.ColorAndOpacity(Dim)
						.Text_Lambda([this]()
						{
							const ASkyStackDirector* D = GetDirector();
							if (!D)
							{
								return FText::GetEmpty();
							}
							return FText::Format(LOCTEXT("FloorsCaption", "FLOORS  \u00B7  {0}  \u00B7  {1}"),
								FText::FromString(D->GetAltitudeText().ToUpper()), FText::FromString(D->GetPaletteName()));
						})
					]

					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(FMargin(0.f, 18.f, 0.f, 0.f))
					[
						SNew(STextBlock)
						.Font(Font(EFace::Body, 22.f))
						.ColorAndOpacity(Gold())
						.Justification(ETextJustify::Center)
						.AutoWrapText(true)
						.Text_Lambda([this]()
						{
							const ASkyStackDirector* D = GetDirector();
							return D ? FText::FromString(D->GetTaunt()) : FText::GetEmpty();
						})
					]

					// Stats
					+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.f, 26.f, 0.f, 0.f))
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().FillWidth(1.f)
						[
							BuildStat([this]()
							{
								const ASkyStackDirector* D = GetDirector();
								return FText::AsNumber(D ? D->Perfects : 0);
							}, LOCTEXT("StatPerfect", "PERFECT"))
						]
						+ SHorizontalBox::Slot().FillWidth(1.f)
						[
							BuildStat([this]()
							{
								const ASkyStackDirector* D = GetDirector();
								return FText::AsNumber(D ? D->MaxCombo : 0);
							}, LOCTEXT("StatCombo", "BEST STREAK"))
						]
						+ SHorizontalBox::Slot().FillWidth(1.f)
						[
							BuildStat([this]()
							{
								const ASkyStackDirector* D = GetDirector();
								return D ? FText::FromString(D->GetZoneName()) : FText::GetEmpty();
							}, LOCTEXT("StatZone", "REACHED"))
						]
					]

					// Run grid (same as the share code)
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(FMargin(0.f, 26.f, 0.f, 0.f))
					[
						SAssignNew(RunGrid, SUniformGridPanel)
						.SlotPadding(FMargin(3.f))
					]

					// Actions
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(FMargin(0.f, 30.f, 0.f, 0.f))
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().Padding(FMargin(6.f, 0.f))
						[
							BuildButton(LOCTEXT("Again", "AGAIN"), LOCTEXT("AgainHint", "SPACE"), true, [this]()
							{
								if (ASkyStackDirector* D = GetDirector())
								{
									D->RequestRetry();
								}
							})
						]
						+ SHorizontalBox::Slot().AutoWidth().Padding(FMargin(6.f, 0.f))
						[
							BuildButton(LOCTEXT("Share", "SHARE"), LOCTEXT("ShareHint", "C"), false, [this]()
							{
								if (ASkyStackDirector* D = GetDirector())
								{
									D->RequestShare();
								}
							})
						]
						+ SHorizontalBox::Slot().AutoWidth().Padding(FMargin(6.f, 0.f))
						[
							BuildButton(LOCTEXT("Menu", "MENU"), LOCTEXT("MenuHint", "TAB"), false, [this]()
							{
								if (ASkyStackDirector* D = GetDirector())
								{
									D->RequestMenu();
								}
							})
						]
					]

					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(FMargin(0.f, 16.f, 0.f, 0.f))
					[
						SNew(STextBlock)
						.Font(Font(EFace::Label, 14.f, 150))
						.ColorAndOpacity_Lambda([this]()
						{
							const ASkyStackDirector* D = GetDirector();
							return FSlateColor(D && D->CopiedTimer > 0.f ? WithAlpha(Mint(), FMath::Min(1.f, D->CopiedTimer)) : Faint);
						})
						.Text_Lambda([this]()
						{
							const ASkyStackDirector* D = GetDirector();
							if (D && D->CopiedTimer > 0.f)
							{
								return LOCTEXT("Copied", "COPIED. PASTE IT IN THE GROUP CHAT.");
							}
							return D && D->Mode == EStackMode::Daily
								? FText::Format(LOCTEXT("DailyFooter", "EVERYONE CLIMBS THE SAME TOWER TODAY  \u00B7  DAILY #{0}"), FText::AsNumber(D->DailyId))
								: LOCTEXT("EndlessFooter", "CLICK ANYWHERE TO CLIMB AGAIN");
						})
					]
				]
			]
		];
}

void SSkyStackOverlay::RebuildRunGrid()
{
	if (!RunGrid.IsValid())
	{
		return;
	}
	RunGrid->ClearChildren();

	const ASkyStackDirector* D = GetDirector();
	if (!D)
	{
		return;
	}

	// One square per floor (last 50), plus a red one for the fall. Squares pop in one by one.
	const TArray<EDropGrade>& Log = D->RunLog;
	const int32 Shown = FMath::Min(Log.Num(), 50);
	const int32 First = Log.Num() - Shown;
	for (int32 Index = 0; Index <= Shown; ++Index)
	{
		const FLinearColor Color = Index < Shown ? GradeColor(Log[First + Index]) : Srgb(0xFF4D5E);
		const float Delay = 0.25f + Index * 0.025f;
		RunGrid->AddSlot(Index % 10, Index / 10)
		[
			SNew(SBox)
			.WidthOverride(22.f)
			.HeightOverride(22.f)
			.RenderTransformPivot(FVector2D(0.5f, 0.5f))
			.RenderTransform_Lambda([this, Delay]() -> TOptional<FSlateRenderTransform>
			{
				const ASkyStackDirector* Director = GetDirector();
				const float T = Director ? (Director->StateTime - Delay) / 0.25f : 1.f;
				return Pop(FMath::Max(0.f, EaseOutBack(T)));
			})
			[
				SNew(SImage)
				.Image(&CellBrush)
				.ColorAndOpacity(Color)
			]
		];
	}
}

#undef LOCTEXT_NAMESPACE
