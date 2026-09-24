#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SkyStackBlock.generated.h"

class UMaterialInstanceDynamic;
class UMaterialInterface;
class UStaticMesh;
class UStaticMeshComponent;

/**
 * Everything visible in SkyStack is one of these: tower floors, falling debris, clouds,
 * confetti, the perfect-drop halo and the backdrop. It is the engine's basic cube (or sphere)
 * tinted through a dynamic instance of BasicShapeMaterial, so the project ships with no
 * binary assets at all.
 */
UCLASS()
class SKYSTACK_API ASkyStackBlock : public AActor
{
	GENERATED_BODY()

public:
	ASkyStackBlock();

	virtual void Tick(float DeltaSeconds) override;

	/** World-space size in unreal units (the source meshes are 100uu). Cancels any size tween. */
	void SetBlockSize(const FVector& InSize);
	const FVector& GetBlockSize() const { return Size; }

	void SetColor(const FLinearColor& InColor);
	const FLinearColor& GetColor() const { return Color; }

	void UseSphereMesh();
	void DisableCollision();
	void SetCastsShadow(bool bCastShadow);

	/** Hand the block over to the physics engine with an initial velocity and spin. */
	void MakeDebris(const FVector& LinearVelocity, const FVector& AngularVelocityDeg);

	/** Kinematic flight under gravity with no collision. Used for confetti. */
	void Launch(const FVector& InVelocity, const FRotator& InSpin);

	/** Jelly bounce played when a floor lands. */
	void Squash(float Amount);

	/** Ease the block's size to Target over Duration. */
	void TweenSize(const FVector& Target, float Duration, bool bDestroyWhenDone = false);

	/** Shrink to nothing, then destroy. */
	void ShrinkAway(float Duration);

private:
	void ApplyScale(const FVector& Multiplier);
	void WakeUp();

	UPROPERTY(VisibleAnywhere, Category = "SkyStack")
	TObjectPtr<UStaticMeshComponent> Mesh;

	UPROPERTY()
	TObjectPtr<UStaticMesh> SphereMesh;

	UPROPERTY()
	TObjectPtr<UMaterialInterface> BaseMaterial;

	UPROPERTY()
	TObjectPtr<UMaterialInstanceDynamic> Material;

	FVector Size = FVector(100.0);
	FLinearColor Color = FLinearColor::White;

	float SquashAmount = 0.f;
	float SquashTime = -1.f;

	FVector TweenFrom = FVector::ZeroVector;
	FVector TweenTarget = FVector::ZeroVector;
	float TweenDuration = 0.f;
	float TweenTime = 0.f;
	bool bDestroyAfterTween = false;

	float ShrinkDuration = 0.f;
	float ShrinkTime = 0.f;

	bool bBallistic = false;
	FVector Velocity = FVector::ZeroVector;
	FRotator Spin = FRotator::ZeroRotator;
};
