import type { Document, Primitive } from '@gltf-transform/core';

export function trianglesOf(p: Primitive): number[][][];
export function jointsOf(p: Primitive): number[] | null;
export function dominantOf(p: Primitive): number[] | null;
export function faceOf(tri: number[][]): { axis: number; sign: number; plane: number; ua: number; va: number; u0: number; u1: number; v0: number; v1: number } | null;
export function cullHidden(doc: Document, voxel: number): number;
