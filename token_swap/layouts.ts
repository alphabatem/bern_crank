import {blob, GetStructureSchema, publicKey, struct, u64, u8} from "../marshmallow";
import {BN, web3} from "@project-serum/anchor";
import assert from "assert";
import {TOKEN_2022_PROGRAM_ID} from "@solana/spl-token";

export class PoolFee {
	numerator: number
	denominator: number

	constructor(numerator: number, denominator: number = 1000) {
		this.numerator = numerator
		this.denominator = denominator
	}
}

export interface SwapInstruction {
	instruction: number;
	amountIn: bigint;
	minimumAmountOut: bigint;
}

export const TokenSwapLayout = struct([
	u8('version'),
	u8('isInitialized'),
	u8('bumpSeed'),
	publicKey('poolTokenProgramId'),
	publicKey('tokenAccountA'),
	publicKey('tokenAccountB'),
	publicKey('tokenPool'),
	publicKey('mintA'),
	publicKey('mintB'),
	publicKey('feeAccount'),
	u64('tradeFeeNumerator'),
	u64('tradeFeeDenominator'),
	u64('ownerTradeFeeNumerator'),
	u64('ownerTradeFeeDenominator'),
	u64('ownerWithdrawFeeNumerator'),
	u64('ownerWithdrawFeeDenominator'),
	u64('hostFeeNumerator'),
	u64('hostFeeDenominator'),
	u8('curveType'),
	blob(32, 'curveParameters'),
]);
export type TokenSwapPoolLayout = typeof TokenSwapLayout;
export type TokenSwapPool = GetStructureSchema<TokenSwapPoolLayout>;

/**
 * Some amount of tokens
 */
export class Numberu64 extends BN {
	/**
	 * Convert to Buffer representation
	 */
	toBuffer(): Buffer {
		const a = super.toArray().reverse();
		const b = Buffer.from(a);
		if (b.length === 8) {
			return b;
		}
		assert(b.length < 8, 'Numberu64 too large');

		const zeroPad = Buffer.alloc(8);
		b.copy(zeroPad);
		return zeroPad;
	}

	/**
	 * Construct a Numberu64 from Buffer representation
	 */
	static fromBuffer(buffer: Buffer): Numberu64 {
		assert(buffer.length === 8, `Invalid buffer length: ${buffer.length}`);
		return new Numberu64(
			[...buffer]
				.reverse()
				.map(i => `00${i.toString(16)}`.slice(-2))
				.join(''),
			16,
		);
	}
}

export class TokenInput {
	mint: web3.PublicKey
	amount: number
	programID: web3.PublicKey = TOKEN_2022_PROGRAM_ID

	constructor(mint: web3.PublicKey, amount: number = 0, programID: web3.PublicKey = TOKEN_2022_PROGRAM_ID) {
		this.mint = mint
		this.amount = amount
		this.programID = programID
	}

	async getMintInfo(connection: web3.Connection) {
		return connection.getTokenSupply(this.mint)
	}
}

export class PoolConfig {
	tradeFee: PoolFee
	ownerTradeFee: PoolFee
	ownerWithdrawFee: PoolFee
	hostFee: PoolFee
	curveType: number

	constructor(
		tradeFee: PoolFee,
		ownerTradeFee: PoolFee,
		ownerWithdrawFee: PoolFee,
		hostFee: PoolFee,
		curveType: number,
	) {
		this.tradeFee = tradeFee
		this.ownerTradeFee = ownerTradeFee
		this.ownerWithdrawFee = ownerWithdrawFee
		this.hostFee = hostFee
		this.curveType = curveType
	}
}