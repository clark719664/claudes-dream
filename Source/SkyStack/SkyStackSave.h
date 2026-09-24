#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "SkyStackSave.generated.h"

UCLASS()
class SKYSTACK_API USkyStackSave : public USaveGame
{
	GENERATED_BODY()

public:
	UPROPERTY()
	int32 BestEndless = 0;

	/** Best score for the daily challenge identified by BestDailyId. */
	UPROPERTY()
	int32 BestDaily = 0;

	UPROPERTY()
	int32 BestDailyId = 0;

	UPROPERTY()
	int32 LastDailyPlayed = 0;

	UPROPERTY()
	int32 DailyStreak = 0;

	UPROPERTY()
	int32 GamesPlayed = 0;

	UPROPERTY()
	int32 TotalFloors = 0;

	UPROPERTY()
	bool bMuted = false;
};
