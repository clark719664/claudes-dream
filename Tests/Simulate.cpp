// Monte Carlo difficulty check: bots with human-like timing error play thousands of runs through
// the real rules. Prints how far each skill level gets, so tuning changes can be judged by numbers.

#include "../Source/SkyStack/SkyStackRules.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <random>
#include <vector>

namespace
{
	using namespace SkyStackRules;
	using namespace SkyStackTuning;

	struct FRunResult
	{
		int32_t Floors = 0;
		int32_t Perfects = 0;
		double Seconds = 0.0;
	};

	/** TimingSigma: standard deviation of the player's press timing, in seconds. */
	FRunResult PlayRun(std::mt19937& Rng, double TimingSigma)
	{
		std::uniform_real_distribution<float> Uniform(0.f, 1.f);
		std::normal_distribution<double> Timing(0.0, TimingSigma);
		FRunResult Result;
		double Extent[2] = { BaseSize, BaseSize };
		int32_t Combo = 0;
		while (Result.Floors < 400)
		{
			const int32_t Floor = Result.Floors;
			float Speed = BaseSliderSpeed(Floor) * (SpeedJitterMin + (SpeedJitterMax - SpeedJitterMin) * Uniform(Rng));
			const bool bWobble = Floor >= WobbleFromFloor && Uniform(Rng) < WobbleChance;
			const bool bRush = Floor >= RushFromFloor && !bWobble && Uniform(Rng) < RushChance;
			if (bRush)
			{
				Speed *= RushMultiplier;
			}
			// On wobble floors the block's speed at the moment of the press varies.
			const double Instant = Speed * (bWobble ? WobbleFactor(Uniform(Rng) * 10.f) : 1.f);
			// Players are a little worse on faster floors: timing error grows mildly with speed.
			const double Error = Timing(Rng) * (1.0 + 0.25 * (Instant / 900.0));
			const double Offset = Instant * Error;

			const int32_t Axis = (Floor + 1) % 2 == 1 ? 0 : 1;
			const FDropOutcome Outcome = ResolveDrop(Offset, Extent[Axis], Speed);
			Result.Seconds += TravelRange / Speed + 0.25;
			if (Outcome.Kind == EDropKind::Miss)
			{
				break;
			}
			if (Outcome.Kind == EDropKind::Perfect)
			{
				++Combo;
				++Result.Perfects;
				if (EarnsGrowth(Combo))
				{
					Extent[0] = Grow(Extent[0]);
					Extent[1] = Grow(Extent[1]);
				}
			}
			else
			{
				Combo = 0;
				Extent[Axis] = Outcome.Kept;
			}
			++Result.Floors;
		}
		return Result;
	}
}

int main()
{
	struct FSkill
	{
		const char* Name;
		double Sigma;
	};
	const FSkill Skills[] =
	{
		{ "first-timer (70ms)", 0.070 },
		{ "casual      (50ms)", 0.050 },
		{ "regular     (38ms)", 0.038 },
		{ "good        (28ms)", 0.028 },
		{ "expert      (20ms)", 0.020 },
	};
	const int32_t Milestones[] = { 15, 30, 45, 60, 75, 90, 100 };
	constexpr int32_t Runs = 20000;

	std::mt19937 Rng(1234);
	std::printf("%-20s %6s %6s %6s %7s %7s |", "skill", "median", "p90", "best", "perfect", "run(s)");
	for (int32_t Milestone : Milestones)
	{
		std::printf(" >=%-4d", Milestone);
	}
	std::printf("\n");

	for (const FSkill& Skill : Skills)
	{
		std::vector<FRunResult> Results;
		Results.reserve(Runs);
		for (int32_t Run = 0; Run < Runs; ++Run)
		{
			Results.push_back(PlayRun(Rng, Skill.Sigma));
		}
		std::sort(Results.begin(), Results.end(), [](const FRunResult& A, const FRunResult& B) { return A.Floors < B.Floors; });
		double PerfectRate = 0.0, Seconds = 0.0;
		int64_t TotalFloors = 0;
		for (const FRunResult& Result : Results)
		{
			TotalFloors += Result.Floors;
			PerfectRate += Result.Perfects;
			Seconds += Result.Seconds;
		}
		PerfectRate /= static_cast<double>(TotalFloors > 0 ? TotalFloors : 1);
		std::printf("%-20s %6d %6d %6d %6.0f%% %7.0f |", Skill.Name,
			Results[Runs / 2].Floors, Results[Runs * 9 / 10].Floors, Results.back().Floors, PerfectRate * 100.0, Seconds / Runs);
		for (int32_t Milestone : Milestones)
		{
			const auto Reached = std::count_if(Results.begin(), Results.end(), [&](const FRunResult& R) { return R.Floors >= Milestone; });
			std::printf(" %5.1f%%", 100.0 * static_cast<double>(Reached) / Runs);
		}
		std::printf("\n");
	}
	return 0;
}
