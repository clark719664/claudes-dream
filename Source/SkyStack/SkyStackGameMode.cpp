#include "SkyStackGameMode.h"

#include "SkyStackDirector.h"
#include "SkyStackHUD.h"

ASkyStackGameMode::ASkyStackGameMode()
{
	DefaultPawnClass = ASkyStackDirector::StaticClass();
	HUDClass = ASkyStackHUD::StaticClass();
}
