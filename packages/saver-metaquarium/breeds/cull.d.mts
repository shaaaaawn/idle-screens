import type { Document, Primitive } from '@gltf-transform/core';

export type Triangle = [number[], number[], number[]];
export function trianglesOf(p: Primitive): Triangle[];
export function jointsOf(p: Primitive): number[] | null;
export function dominantOf(p: Primitive): number[] | null;
export function faceOf(tri: Triangle): { axis: number; sign: number; plane: number; ua: number; va: number; u0: number; u1: number; v0: number; v1: number } | null;
export function cullHidden(doc: Document, voxel: number): number;
