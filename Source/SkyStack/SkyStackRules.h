#pragma once

// SkyStack's game rules, free of any engine types so they can be unit tested and simulated
// outside Unreal (see Tests/). ASkyStackDirector drives the game with these.

#include <cmath>
#include <cstdint>

namespace SkyStackTuning
{
	constexpr double BlockHeight = 36.0;
	constexpr double BaseSize = 320.0;
	/** Minimum perfect window in world units. */
	constexpr double PerfectTolerance = 8.0;
	/** The perfect window also widens with speed so it stays this long in time, not a fixed distance... */
	constexpr double PerfectWindowSeconds = 0.028;
	/** ...up to this width, so the late game keeps getting harder. */
	constexpr double PerfectToleranceMax = 16.0;
	/** How far either side of the tower the moving block travels before turning back. */
	constexpr double TravelRange = 420.0;
	constexpr double GrowAmount = 16.0;
	constexpr float BaseSpeed = 380.f;
	constexpr float SpeedPerFloor = 7.5f;
	constexpr float MaxSpeed = 1250.f;
	constexpr int32_t ComboToGrow = 4;
	constexpr int32_t FloorsPerZone = 15;
	/** Keeping less than this fraction of the block counts as a clutch save. */
	constexpr double ClutchRatio = 0.3;
	constexpr int32_t WobbleFromFloor = 10;
	constexpr float WobbleChance = 0.18f;
	constexpr int32_t RushFromFloor = 20;
	constexpr float RushChance = 0.12f;
	constexpr float RushMultiplier = 1.35f;
	constexpr float SpeedJitterMin = 0.9f;
	constexpr float SpeedJitterMax = 1.12f;
	/** The tower starts on a sea cliff this high, then every floor climbs further. */
	constexpr double StartAltitudeMeters = 300.0;
	constexpr double MetersPerFloor = 80.0;
	/** Past this floor the climb turns exponential, reaching orbit around floor 100. */
	constexpr double SpaceRaceFloor = 75.0;
	constexpr double SpaceRaceFloorsPerE = 8.0;
	constexpr double OrbitAltitudeMeters = 140000.0;
}

namespace SkyStackRules
{
	enum class EDropKind : uint8_t
	{
		Miss,
		Perfect,
		Good,
		Clutch
	};

	/** What happens when the moving block is dropped, measured along its slide axis. */
	struct FDropOutcome
	{
		EDropKind Kind = EDropKind::Miss;
		/** Length of the new top block along the axis. */
		double Kept = 0.0;
		/** How far the new top's centre moves from the old top's centre. */
		double CenterShift = 0.0;
		/** Length of the piece that breaks off (0 for perfect and miss). */
		double Chip = 0.0;
		/** Centre of the broken piece, relative to the old top's centre. */
		double ChipShift = 0.0;
	};

	inline double Min(double A, double B) { return A < B ? A : B; }
	inline double Max(double A, double B) { return A > B ? A : B; }

	inline double PerfectWindow(double SliderSpeed)
	{
		return Max(SkyStackTuning::PerfectTolerance, Min(SliderSpeed * SkyStackTuning::PerfectWindowSeconds, SkyStackTuning::PerfectToleranceMax));
	}

	/**
	 * Resolves a drop. Offset is the moving block's centre relative to the top block's centre
	 * along the slide axis; Extent is the top block's length along that axis.
	 */
	inline FDropOutcome ResolveDrop(double Offset, double Extent, double SliderSpeed)
	{
		FDropOutcome Out;
		const double Error = std::fabs(Offset);
		if (Error >= Extent)
		{
			Out.Kind = EDropKind::Miss;
			return Out;
		}
		if (Error <= PerfectWindow(SliderSpeed))
		{
			Out.Kind = EDropKind::Perfect;
			Out.Kept = Extent;
			return Out;
		}
		const double Side = Offset > 0.0 ? 1.0 : -1.0;
		Out.Kept = Extent - Error;
		Out.CenterShift = Offset * 0.5;
		Out.Chip = Error;
		Out.ChipShift = Offset * 0.5 + Side * Extent * 0.5;
		Out.Kind = Out.Kept / Extent < SkyStackTuning::ClutchRatio ? EDropKind::Clutch : EDropKind::Good;
		return Out;
	}

	/** A perfect streak this long starts earning width back. */
	inline bool EarnsGrowth(int32_t Combo)
	{
		return Combo >= SkyStackTuning::ComboToGrow;
	}

	inline double Grow(double Extent)
	{
		return Min(Extent + SkyStackTuning::GrowAmount, SkyStackTuning::BaseSize);
	}

	/** Slide speed before per-floor jitter and twists. */
	inline float BaseSliderSpeed(int32_t Floor)
	{
		const float Speed = SkyStackTuning::BaseSpeed + SkyStackTuning::SpeedPerFloor * static_cast<float>(Floor);
		return Speed < SkyStackTuning::MaxSpeed ? Speed : SkyStackTuning::MaxSpeed;
	}

	/** Speed multiplier on WOBBLE floors, as a function of time on the floor. */
	inline float WobbleFactor(float Seconds)
	{
		return 1.f + 0.6f * std::sin(Seconds * 4.2f);
	}

	/** Moves the slider along its axis and bounces it off the ends of its travel. */
	inline void AdvanceSlider(double& Offset, float& Direction, double Distance)
	{
		Offset += Direction * Distance;
		if (Offset > SkyStackTuning::TravelRange)
		{
			Offset = SkyStackTuning::TravelRange;
			Direction = -1.f;
		}
		else if (Offset < -SkyStackTuning::TravelRange)
		{
			Offset = -SkyStackTuning::TravelRange;
			Direction = 1.f;
		}
	}

	inline int32_t ZoneForFloor(int32_t Floor, int32_t NumZones)
	{
		const int32_t Zone = Floor / SkyStackTuning::FloorsPerZone;
		return Zone < 0 ? 0 : (Zone >= NumZones ? NumZones - 1 : Zone);
	}

	/** Linear through the weather (~6 km at floor 75), then exponential into space: orbit near floor 100. */
	inline double AltitudeMetersForFloor(double Floor)
	{
		using namespace SkyStackTuning;
		const double AtKnee = StartAltitudeMeters + SpaceRaceFloor * MetersPerFloor;
		if (Floor <= SpaceRaceFloor)
		{
			return StartAltitudeMeters + Max(Floor, 0.0) * MetersPerFloor;
		}
		return Min(AtKnee * std::exp((Floor - SpaceRaceFloor) / SpaceRaceFloorsPerE), OrbitAltitudeMeters);
	}

	/** 0 while the tower is comfortable, rising to 1 as its narrowest side approaches nothing. */
	inline float Danger(double NarrowestSide)
	{
		const double Value = 1.0 - NarrowestSide / (SkyStackTuning::BaseSize * 0.3);
		return static_cast<float>(Value < 0.0 ? 0.0 : (Value > 1.0 ? 1.0 : Value));
	}

	/** Adaptive music intensity: -1 ducked, 0 title, up to 3 at a hot streak or high altitude. */
	inline int32_t MusicLevel(bool bPlaying, bool bTitle, int32_t Combo, int32_t Floor)
	{
		if (bTitle)
		{
			return 0;
		}
		if (!bPlaying)
		{
			return -1;
		}
		return 1 + ((Combo >= 3 || Floor >= 15) ? 1 : 0) + ((Combo >= 6 || Floor >= 45) ? 1 : 0);
	}
}
