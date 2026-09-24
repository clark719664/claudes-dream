#include "SkyStackHUD.h"

#include "SkyStackUI.h"

#include "Engine/GameViewportClient.h"
#include "Engine/World.h"

void ASkyStackHUD::BeginPlay()
{
	Super::BeginPlay();

	if (UGameViewportClient* Viewport = GetWorld() ? GetWorld()->GetGameViewport() : nullptr)
	{
		Overlay = SNew(SSkyStackOverlay).Owner(GetOwningPlayerController());
		Viewport->AddViewportWidgetContent(Overlay.ToSharedRef(), 10);
	}
}

void ASkyStackHUD::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (Overlay.IsValid())
	{
		if (UGameViewportClient* Viewport = GetWorld() ? GetWorld()->GetGameViewport() : nullptr)
		{
			Viewport->RemoveViewportWidgetContent(Overlay.ToSharedRef());
		}
		Overlay.Reset();
	}
	Super::EndPlay(EndPlayReason);
}
