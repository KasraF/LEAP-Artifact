/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a synchronous diff algorithm. Should be executed in a worker.
*/
export interface IDiffAlgorithm {
	compute(sequence1: ISequence, sequence2: ISequence): SequenceDiff[];
}

export class SequenceDiff {
	constructor(
		public readonly seq1Range: OffsetRange,
		public readonly seq2Range: OffsetRange
	) { }
}

/**
 * Todo move this class to some top level utils.
*/
export class OffsetRange {
	constructor(public readonly start: number, public readonly endExclusive: number) { }

	get isEmpty(): boolean {
		return this.start === this.endExclusive;
	}

	public delta(offset: number): OffsetRange {
		return new OffsetRange(this.start + offset, this.endExclusive + offset);
	}

	public get length(): number {
		return this.endExclusive - this.start;
	}
}

export interface ISequence {
	getElement(offset: number): number;
	get length(): number;
}

export class SequenceFromIntArray implements ISequence {
	constructor(private readonly arr: number[]) { }

	getElement(offset: number): number {
		return this.arr[offset];
	}

	get length(): number {
		return this.arr.length;
	}
}
