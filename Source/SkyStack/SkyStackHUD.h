#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "SkyStackHUD.generated.h"

class SWidget;

/** Mounts SSkyStackOverlay (the Slate UI in SkyStackUI.h) onto the game viewport. */
UCLASS()
class SKYSTACK_API ASkyStackHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

private:
	TSharedPtr<SWidget> Overlay;
};
