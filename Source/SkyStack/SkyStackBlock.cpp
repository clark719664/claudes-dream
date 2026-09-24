#include "SkyStackBlock.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/CollisionProfile.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"

ASkyStackBlock::ASkyStackBlock()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = false;

	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	RootComponent = Mesh;
	Mesh->SetMobility(EComponentMobility::Movable);
	Mesh->SetCollisionProfileName(UCollisionProfile::BlockAll_ProfileName);
	Mesh->SetGenerateOverlapEvents(false);

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeFinder(TEXT("/Engine/BasicShapes/Cube.Cube"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereFinder(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> MaterialFinder(TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));

	if (CubeFinder.Succeeded())
	{
		Mesh->SetStaticMesh(CubeFinder.Object);
	}
	SphereMesh = SphereFinder.Object;
	BaseMaterial = MaterialFinder.Object;
}

void ASkyStackBlock::SetBlockSize(const FVector& InSize)
{
	Size = InSize;
	TweenDuration = 0.f;
	ApplyScale(FVector::OneVector);
}

void ASkyStackBlock::SetColor(const FLinearColor& InColor)
{
	Color = InColor;
	if (!Material)
	{
		UMaterialInterface* Parent = BaseMaterial ? BaseMaterial.Get() : Mesh->GetMaterial(0);
		Material = UMaterialInstanceDynamic::Create(Parent, this);
		if (Material)
		{
			Mesh->SetMaterial(0, Material);
		}
	}
	if (Material)
	{
		// BasicShapeMaterial exposes a single "Color" vector parameter.
		Material->SetVectorParameterValue(TEXT("Color"), Color);
	}
}

void ASkyStackBlock::UseSphereMesh()
{
	if (SphereMesh)
	{
		Mesh->SetStaticMesh(SphereMesh);
		if (Material)
		{
			Mesh->SetMaterial(0, Material);
		}
	}
}

void ASkyStackBlock::DisableCollision()
{
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void ASkyStackBlock::SetCastsShadow(bool bCastShadow)
{
	Mesh->SetCastShadow(bCastShadow);
}

void ASkyStackBlock::MakeDebris(const FVector& LinearVelocity, const FVector& AngularVelocityDeg)
{
	// Settle any running animation so the physics body matches what the player sees.
	if (TweenDuration > 0.f)
	{
		Size = TweenTarget;
		TweenDuration = 0.f;
	}
	SquashTime = -1.f;
	ApplyScale(FVector::OneVector);

	Mesh->SetCollisionProfileName(UCollisionProfile::PhysicsActor_ProfileName);
	Mesh->SetSimulatePhysics(true);
	Mesh->SetPhysicsLinearVelocity(LinearVelocity);
	Mesh->SetPhysicsAngularVelocityInDegrees(AngularVelocityDeg);
}

void ASkyStackBlock::Launch(const FVector& InVelocity, const FRotator& InSpin)
{
	DisableCollision();
	bBallistic = true;
	Velocity = InVelocity;
	Spin = InSpin;
	WakeUp();
}

void ASkyStackBlock::Squash(float Amount)
{
	SquashAmount = Amount;
	SquashTime = 0.f;
	WakeUp();
}

void ASkyStackBlock::TweenSize(const FVector& Target, float Duration, bool bDestroyWhenDone)
{
	TweenFrom = Size;
	TweenTarget = Target;
	TweenDuration = FMath::Max(Duration, KINDA_SMALL_NUMBER);
	TweenTime = 0.f;
	bDestroyAfterTween = bDestroyWhenDone;
	WakeUp();
}

void ASkyStackBlock::ShrinkAway(float Duration)
{
	ShrinkDuration = FMath::Max(Duration, KINDA_SMALL_NUMBER);
	ShrinkTime = 0.f;
	WakeUp();
}

void ASkyStackBlock::WakeUp()
{
	SetActorTickEnabled(true);
}

void ASkyStackBlock::ApplyScale(const FVector& Multiplier)
{
	SetActorScale3D(Size / 100.0 * Multiplier);
}

void ASkyStackBlock::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	bool bBusy = false;
	FVector Multiplier = FVector::OneVector;

	if (TweenDuration > 0.f)
	{
		TweenTime += DeltaSeconds;
		const float Alpha = FMath::Clamp(TweenTime / TweenDuration, 0.f, 1.f);
		const float Eased = 1.f - FMath::Pow(1.f - Alpha, 3.f);
		Size = FMath::Lerp(TweenFrom, TweenTarget, static_cast<double>(Eased));
		if (Alpha >= 1.f)
		{
			TweenDuration = 0.f;
			if (bDestroyAfterTween)
			{
				Destroy();
				return;
			}
		}
		else
		{
			bBusy = true;
		}
	}

	if (SquashTime >= 0.f)
	{
		SquashTime += DeltaSeconds;
		// Damped spring: squash down, overshoot up, settle.
		const float Wobble = SquashAmount * FMath::Exp(-SquashTime * 9.f) * FMath::Cos(SquashTime * 32.f);
		Multiplier.Z = 1.0 - Wobble;
		Multiplier.X = 1.0 + Wobble * 0.5;
		Multiplier.Y = 1.0 + Wobble * 0.5;
		if (SquashTime > 0.6f)
		{
			SquashTime = -1.f;
			Multiplier = FVector::OneVector;
		}
		else
		{
			bBusy = true;
		}
	}

	if (ShrinkDuration > 0.f)
	{
		ShrinkTime += DeltaSeconds;
		const float Alpha = ShrinkTime / ShrinkDuration;
		if (Alpha >= 1.f)
		{
			Destroy();
			return;
		}
		Multiplier *= static_cast<double>(1.f - Alpha * Alpha);
		bBusy = true;
	}

	if (bBallistic)
	{
		Velocity.Z -= 2200.0 * DeltaSeconds;
		AddActorWorldOffset(Velocity * DeltaSeconds);
		AddActorWorldRotation(Spin * DeltaSeconds);
		bBusy = true;
	}

	if (!Mesh->IsSimulatingPhysics())
	{
		ApplyScale(Multiplier);
	}

	if (!bBusy)
	{
		SetActorTickEnabled(false);
	}
}
