#include "SkyStackHUD.h"

#include "SkyStackDirector.h"
#include "SkyStackSave.h"

#include "CanvasItem.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"

namespace
{
	const FLinearColor HudGold(1.f, 0.78f, 0.2f);
	const FLinearColor HudWhite(1.f, 1.f, 1.f);
	const FLinearColor HudDim(1.f, 1.f, 1.f, 0.6f);

	FLinearColor WithAlpha(FLinearColor Color, float Alpha)
	{
		Color.A *= Alpha;
		return Color;
	}

	FLinearColor Rainbow(float Hue)
	{
		return FLinearColor(FMath::Fmod(Hue, 360.f), 0.55f, 1.f).HSVToLinearRGB();
	}

	FLinearColor GradeColor(EDropGrade Grade)
	{
		switch (Grade)
		{
		case EDropGrade::Perfect: return FLinearColor(0.3f, 0.85f, 0.4f);
		case EDropGrade::Good:    return FLinearColor(1.f, 0.8f, 0.2f);
		default:                  return FLinearColor(1.f, 0.5f, 0.15f);
		}
	}
}

void ASkyStackHUD::DrawHUD()
{
	Super::DrawHUD();

	const ASkyStackDirector* Director = Cast<ASkyStackDirector>(GetOwningPawn());
	if (!Font && GEngine)
	{
		Font = GEngine->GetLargeFont();
	}
	if (!Director || !Canvas || !Font)
	{
		return;
	}

	ScreenW = static_cast<float>(Canvas->ClipX);
	ScreenH = static_cast<float>(Canvas->ClipY);
	// Scale against 1080p, but also against width so portrait phones don't overflow.
	UI = FMath::Min(ScreenH / 1080.f, ScreenW / 1200.f);

	switch (Director->State)
	{
	case EStackState::Title:
		DrawTitle(*Director);
		break;
	case EStackState::Playing:
		DrawPlaying(*Director);
		break;
	case EStackState::Collapsing:
		DrawLabel(FString::FromInt(Director->Floor), ScreenW * 0.5f, ScreenH * 0.12f, 130.f, HudWhite);
		break;
	case EStackState::GameOver:
		DrawGameOver(*Director);
		break;
	}

	DrawToasts(*Director);
}

void ASkyStackHUD::DrawTitle(const ASkyStackDirector& Director)
{
	const float Time = Director.RealTime;
	const float CenterX = ScreenW * 0.5f;
	const float Fade = FMath::Clamp(Director.StateTime * 2.f, 0.f, 1.f);

	// Bouncing rainbow logo, one letter at a time.
	const FString Logo = TEXT("SKYSTACK");
	const float LogoPx = 150.f;
	TArray<float> Widths;
	float Total = 0.f;
	for (int32 Index = 0; Index < Logo.Len(); ++Index)
	{
		const float Width = MeasureLabel(Logo.Mid(Index, 1), LogoPx).X + 6.f * UI;
		Widths.Add(Width);
		Total += Width;
	}
	float X = CenterX - Total * 0.5f;
	for (int32 Index = 0; Index < Logo.Len(); ++Index)
	{
		const float Bob = FMath::Sin(Time * 3.f + Index * 0.6f) * 12.f * UI;
		const FLinearColor Color = WithAlpha(Rainbow(Time * 40.f + Index * 28.f), Fade);
		DrawLabel(Logo.Mid(Index, 1), X + Widths[Index] * 0.5f, ScreenH * 0.2f + Bob, LogoPx, Color);
		X += Widths[Index];
	}
	DrawLabel(TEXT("how high can you go?"), CenterX, ScreenH * 0.31f, 40.f, WithAlpha(HudWhite, 0.9f * Fade));

	const float CardOffset = 270.f * UI;
	DrawModeCard(Director, true, CenterX - CardOffset, ScreenH * 0.52f);
	DrawModeCard(Director, false, CenterX + CardOffset, ScreenH * 0.52f);

	const float Pulse = 0.55f + 0.45f * FMath::Sin(Time * 4.f);
	DrawLabel(TEXT("SPACE / CLICK / TAP TO PLAY"), CenterX, ScreenH * 0.76f, 46.f, WithAlpha(HudWhite, Pulse * Fade));

	if (Director.Save && Director.Save->GamesPlayed > 0)
	{
		const FString Stats = FString::Printf(TEXT("%d runs  -  %d floors stacked all-time"), Director.Save->GamesPlayed, Director.Save->TotalFloors);
		DrawLabel(Stats, CenterX, ScreenH * 0.84f, 24.f, WithAlpha(HudDim, Fade));
	}
	DrawLabel(TEXT("D daily   E endless   M sound   ESC quit"), CenterX, ScreenH * 0.92f, 24.f, WithAlpha(HudDim, Fade));
}

void ASkyStackHUD::DrawModeCard(const ASkyStackDirector& Director, bool bDaily, float CenterX, float CenterY)
{
	const bool bSelected = (Director.Mode == EStackMode::Daily) == bDaily;
	const float W = 460.f * UI;
	const float H = 200.f * UI;
	const float Left = CenterX - W * 0.5f;
	const float Top = CenterY - H * 0.5f;
	const float Alpha = bSelected ? 1.f : 0.55f;

	DrawRect(FLinearColor(0.f, 0.f, 0.f, bSelected ? 0.45f : 0.25f), Left, Top, W, H);
	if (bSelected)
	{
		const float Glow = 0.7f + 0.3f * FMath::Sin(Director.RealTime * 5.f);
		DrawFrame(Left, Top, W, H, 4.f * UI, WithAlpha(HudGold, Glow));
	}

	const USkyStackSave* Save = Director.Save;
	if (bDaily)
	{
		DrawLabel(FString::Printf(TEXT("DAILY #%d"), Director.DailyId), CenterX, Top + 45.f * UI, 48.f, WithAlpha(HudGold, Alpha));
		DrawLabel(TEXT("same tower for everyone today"), CenterX, Top + 95.f * UI, 24.f, WithAlpha(HudWhite, 0.85f * Alpha));
		const int32 Best = Save ? Save->BestDaily : 0;
		DrawLabel(Best > 0 ? FString::Printf(TEXT("today's best: %d"), Best) : FString(TEXT("not played yet today")), CenterX, Top + 135.f * UI, 28.f, WithAlpha(HudWhite, Alpha));
		if (Save && Save->DailyStreak > 1 && Save->LastDailyPlayed >= Director.DailyId - 1)
		{
			DrawLabel(FString::Printf(TEXT("%d day streak"), Save->DailyStreak), CenterX, Top + 172.f * UI, 24.f, WithAlpha(FLinearColor(1.f, 0.5f, 0.2f), Alpha));
		}
	}
	else
	{
		DrawLabel(TEXT("ENDLESS"), CenterX, Top + 45.f * UI, 48.f, WithAlpha(FLinearColor(0.5f, 0.85f, 1.f), Alpha));
		DrawLabel(TEXT("new random tower every run"), CenterX, Top + 95.f * UI, 24.f, WithAlpha(HudWhite, 0.85f * Alpha));
		const int32 Best = Save ? Save->BestEndless : 0;
		DrawLabel(FString::Printf(TEXT("best: %d"), Best), CenterX, Top + 135.f * UI, 28.f, WithAlpha(HudWhite, Alpha));
	}
}

void ASkyStackHUD::DrawPlaying(const ASkyStackDirector& Director)
{
	const float CenterX = ScreenW * 0.5f;
	const float Time = Director.RealTime;

	// Danger vignette when the tower gets razor thin.
	const float Danger = Director.GetDanger();
	if (Danger > 0.f)
	{
		const float Alpha = Danger * (0.22f + 0.15f * FMath::Sin(Time * 10.f));
		const float Edge = 40.f * UI;
		const FLinearColor Red(1.f, 0.1f, 0.1f, Alpha);
		DrawRect(Red, 0.f, 0.f, ScreenW, Edge);
		DrawRect(Red, 0.f, ScreenH - Edge, ScreenW, Edge);
		DrawRect(Red, 0.f, Edge, Edge, ScreenH - 2.f * Edge);
		DrawRect(Red, ScreenW - Edge, Edge, Edge, ScreenH - 2.f * Edge);
	}

	const float Pop = Director.ScorePop;
	DrawLabel(FString::FromInt(Director.Floor), CenterX, ScreenH * 0.12f, 130.f * (1.f + 0.3f * Pop * Pop), HudWhite);
	if (Director.Combo >= 2)
	{
		DrawLabel(FString::Printf(TEXT("COMBO x%d"), Director.Combo), CenterX, ScreenH * 0.2f, 34.f, HudGold);
	}

	const float Margin = 40.f * UI;
	DrawLabel(Director.GetZoneName(), Margin, Margin + 10.f * UI, 28.f, WithAlpha(HudWhite, 0.85f), 0.f);
	DrawLabel(Director.Mode == EStackMode::Daily ? FString::Printf(TEXT("DAILY #%d"), Director.DailyId) : FString(TEXT("ENDLESS")),
		Margin, Margin + 50.f * UI, 22.f, HudDim, 0.f);
	DrawLabel(FString::Printf(TEXT("BEST %d"), Director.GetBest()), ScreenW - Margin, Margin + 10.f * UI, 28.f, HudGold, 1.f);

	// Label the record frame hanging in the world.
	if (Director.BestMarker.Num() > 0)
	{
		const FVector Screen = Canvas->Project(Director.GetBestMarkerLocation());
		if (Screen.Z > 0.0)
		{
			DrawLabel(FString::Printf(TEXT("BEST %d"), Director.GetBest()), static_cast<float>(Screen.X) + 14.f * UI, static_cast<float>(Screen.Y), 26.f, HudGold, 0.f);
		}
	}

	if (Director.Floor < 2)
	{
		const float Pulse = 0.5f + 0.5f * FMath::Sin(Time * 5.f);
		DrawLabel(TEXT("TAP / SPACE TO DROP"), CenterX, ScreenH * 0.86f, 36.f, WithAlpha(HudWhite, 0.4f + 0.6f * Pulse));
	}
}

void ASkyStackHUD::DrawGameOver(const ASkyStackDirector& Director)
{
	const float CenterX = ScreenW * 0.5f;
	const float Time = Director.RealTime;
	const float Appear = FMath::Clamp(Director.StateTime * 3.f, 0.f, 1.f);
	const float Slide = (1.f - Appear) * 40.f * UI;

	DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.35f * Appear), 0.f, 0.f, ScreenW, ScreenH);

	if (Director.bNewBest)
	{
		// Per-letter rainbow: the money shot for screenshots.
		const FString Headline = TEXT("NEW BEST!");
		float Total = 0.f;
		TArray<float> Widths;
		for (int32 Index = 0; Index < Headline.Len(); ++Index)
		{
			const float Width = MeasureLabel(Headline.Mid(Index, 1), 70.f).X + 2.f * UI;
			Widths.Add(Width);
			Total += Width;
		}
		float X = CenterX - Total * 0.5f;
		for (int32 Index = 0; Index < Headline.Len(); ++Index)
		{
			const float Bob = FMath::Sin(Time * 6.f + Index * 0.7f) * 6.f * UI;
			DrawLabel(Headline.Mid(Index, 1), X + Widths[Index] * 0.5f, ScreenH * 0.1f + Bob + Slide, 70.f, WithAlpha(Rainbow(Time * 120.f + Index * 35.f), Appear));
			X += Widths[Index];
		}
	}
	else
	{
		DrawLabel(TEXT("TOWER DOWN"), CenterX, ScreenH * 0.1f + Slide, 60.f, WithAlpha(HudWhite, 0.9f * Appear));
	}

	DrawLabel(FString::FromInt(Director.Floor), CenterX, ScreenH * 0.22f + Slide, 170.f, WithAlpha(HudWhite, Appear));
	DrawLabel(Director.Floor == 1 ? TEXT("FLOOR") : TEXT("FLOORS"), CenterX, ScreenH * 0.315f + Slide, 30.f, WithAlpha(HudDim, Appear));
	DrawLabel(Director.GetTaunt(), CenterX, ScreenH * 0.37f + Slide, 34.f, WithAlpha(HudGold, Appear));

	const FString Stats = FString::Printf(TEXT("%d perfect   -   max combo %d   -   reached %s"),
		Director.Perfects, Director.MaxCombo, *Director.GetZoneName());
	DrawLabel(Stats, CenterX, ScreenH * 0.43f + Slide, 26.f, WithAlpha(HudWhite, 0.85f * Appear));

	DrawRunGrid(Director, CenterX, ScreenH * 0.48f + Slide, Appear);

	const float Pulse = 0.6f + 0.4f * FMath::Sin(Time * 4.f);
	DrawLabel(TEXT("SPACE  again        C  copy share code        TAB  menu"), CenterX, ScreenH * 0.86f, 30.f, WithAlpha(HudWhite, Pulse * Appear));
	if (Director.CopiedTimer > 0.f)
	{
		DrawLabel(TEXT("COPIED! Paste it in the group chat."), CenterX, ScreenH * 0.92f, 32.f,
			WithAlpha(FLinearColor(0.45f, 1.f, 0.6f), FMath::Min(1.f, Director.CopiedTimer)));
	}
	else if (Director.Mode == EStackMode::Daily)
	{
		DrawLabel(FString::Printf(TEXT("Everyone gets the same tower today. Daily #%d."), Director.DailyId), CenterX, ScreenH * 0.92f, 24.f, WithAlpha(HudDim, Appear));
	}
}

void ASkyStackHUD::DrawRunGrid(const ASkyStackDirector& Director, float CenterX, float TopY, float Alpha)
{
	// The same grid as the share text: green perfect, yellow trimmed, orange clutch, red the fall.
	const TArray<EDropGrade>& Log = Director.RunLog;
	const int32 Shown = FMath::Min(Log.Num(), 50);
	const int32 First = Log.Num() - Shown;
	const int32 Cells = Shown + 1;
	constexpr int32 Columns = 10;
	const float Cell = 26.f * UI;
	const float Gap = 6.f * UI;
	const int32 UsedColumns = FMath::Min(Cells, Columns);
	const float GridW = UsedColumns * Cell + (UsedColumns - 1) * Gap;
	const float Left = CenterX - GridW * 0.5f;

	for (int32 Index = 0; Index < Cells; ++Index)
	{
		// Squares pop in one after another.
		const float Reveal = FMath::Clamp(Director.StateTime * 30.f - Index, 0.f, 1.f);
		if (Reveal <= 0.f)
		{
			break;
		}
		const FLinearColor Color = Index < Shown ? GradeColor(Log[First + Index]) : FLinearColor(0.95f, 0.2f, 0.2f);
		const float Size = Cell * Reveal;
		const float X = Left + (Index % Columns) * (Cell + Gap) + (Cell - Size) * 0.5f;
		const float Y = TopY + (Index / Columns) * (Cell + Gap) + (Cell - Size) * 0.5f;
		DrawRect(WithAlpha(Color, Alpha), X, Y, Size, Size);
	}

	if (First > 0)
	{
		const int32 Rows = (Cells + Columns - 1) / Columns;
		DrawLabel(FString::Printf(TEXT("+%d floors below"), First), CenterX, TopY + Rows * (Cell + Gap) + 18.f * UI, 22.f, WithAlpha(HudDim, Alpha));
	}
}

void ASkyStackHUD::DrawToasts(const ASkyStackDirector& Director)
{
	const float CenterX = ScreenW * 0.5f;
	float Y = ScreenH * 0.34f;
	for (int32 Index = Director.Toasts.Num() - 1; Index >= 0; --Index)
	{
		const FStackToast& Toast = Director.Toasts[Index];
		const float Life01 = Toast.Age / FMath::Max(Toast.Life, 0.01f);
		const float Alpha = Life01 < 0.65f ? 1.f : 1.f - (Life01 - 0.65f) / 0.35f;
		const float PopScale = 1.f + 0.45f * FMath::Exp(-Toast.Age * 14.f);
		const float Rise = Toast.Age * 50.f * UI;
		DrawLabel(Toast.Text, CenterX, Y - Rise, Toast.Size * PopScale, WithAlpha(Toast.Color, Alpha));
		Y += Toast.Size * 1.1f * UI;
	}
}

void ASkyStackHUD::DrawLabel(const FString& Text, float X, float Y, float Px, const FLinearColor& Color, float AlignX)
{
	const float BaseHeight = FMath::Max(1.f, static_cast<float>(Font->GetMaxCharHeight()));
	const float Scale = Px * UI / BaseHeight;
	const FVector2D Size = MeasureLabel(Text, Px);

	FCanvasTextItem Item(FVector2D(X - Size.X * AlignX, Y - Size.Y * 0.5f), FText::FromString(Text), Font, Color);
	Item.Scale = FVector2D(Scale, Scale);
	Item.EnableShadow(FLinearColor(0.f, 0.f, 0.f, 0.5f * Color.A), FVector2D(3.f * UI, 3.f * UI));
	Item.BlendMode = SE_BLEND_Translucent;
	Canvas->DrawItem(Item);
}

FVector2D ASkyStackHUD::MeasureLabel(const FString& Text, float Px) const
{
	const float BaseHeight = FMath::Max(1.f, static_cast<float>(Font->GetMaxCharHeight()));
	const float Scale = Px * UI / BaseHeight;
	float Width = 0.f;
	float Height = 0.f;
	GetTextSize(Text, Width, Height, Font, Scale);
	return FVector2D(Width, Height);
}

void ASkyStackHUD::DrawFrame(float X, float Y, float W, float H, float Thickness, const FLinearColor& Color)
{
	DrawRect(Color, X, Y, W, Thickness);
	DrawRect(Color, X, Y + H - Thickness, W, Thickness);
	DrawRect(Color, X, Y + Thickness, Thickness, H - 2.f * Thickness);
	DrawRect(Color, X + W - Thickness, Y + Thickness, Thickness, H - 2.f * Thickness);
}
