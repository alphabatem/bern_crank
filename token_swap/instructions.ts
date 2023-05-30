import {struct, u64, u8} from "../marshmallow";
import {BN, web3} from "@project-serum/anchor";

export default class Instructions {

	static createSwapInstruction(
		tokenSwap: web3.PublicKey,
		authority: web3.PublicKey,
		userTransferAuthority: web3.PublicKey,
		userSource: web3.PublicKey,
		poolSource: web3.PublicKey,
		poolDestination: web3.PublicKey,
		userDestination: web3.PublicKey,
		poolMint: web3.PublicKey,
		feeAccount: web3.PublicKey,
		hostFeeAccount: web3.PublicKey | null,
		sourceMint: web3.PublicKey,
		destinationMint: web3.PublicKey,
		swapProgramId: web3.PublicKey,
		sourceTokenProgramId: web3.PublicKey,
		destinationTokenProgramId: web3.PublicKey,
		poolTokenProgramId: web3.PublicKey,
		amountIn: BN,
		minimumAmountOut: BN,
	): web3.TransactionInstruction {
		const dataLayout = struct([
			u8('instruction'),
			u64('amountIn'),
			u64('minimumAmountOut'),
		]);

		const data = Buffer.alloc(dataLayout.span);
		dataLayout.encode(
			{
				instruction: 1, // Swap instruction
				amountIn: amountIn,
				minimumAmountOut: minimumAmountOut,
			},
			data,
		);

		const keys = [
			{pubkey: tokenSwap, isSigner: false, isWritable: false},
			{pubkey: authority, isSigner: false, isWritable: false},
			{pubkey: userTransferAuthority, isSigner: true, isWritable: false},
			{pubkey: userSource, isSigner: false, isWritable: true},
			{pubkey: poolSource, isSigner: false, isWritable: true},
			{pubkey: poolDestination, isSigner: false, isWritable: true},
			{pubkey: userDestination, isSigner: false, isWritable: true},
			{pubkey: poolMint, isSigner: false, isWritable: true},
			{pubkey: feeAccount, isSigner: false, isWritable: true},
			{pubkey: sourceMint, isSigner: false, isWritable: false},
			{pubkey: destinationMint, isSigner: false, isWritable: false},
			{pubkey: sourceTokenProgramId, isSigner: false, isWritable: false},
			{pubkey: destinationTokenProgramId, isSigner: false, isWritable: false},
			{pubkey: poolTokenProgramId, isSigner: false, isWritable: false},
		];
		if (hostFeeAccount !== null) {
			keys.push({pubkey: hostFeeAccount, isSigner: false, isWritable: true});
		}
		return new web3.TransactionInstruction({
			keys,
			programId: swapProgramId,
			data,
		});
	}

	static depositAllTokenTypesInstruction(
		tokenSwap: web3.PublicKey,
		authority: web3.PublicKey,
		userTransferAuthority: web3.PublicKey,
		sourceA: web3.PublicKey,
		sourceB: web3.PublicKey,
		intoA: web3.PublicKey,
		intoB: web3.PublicKey,
		poolToken: web3.PublicKey,
		poolAccount: web3.PublicKey,
		mintA: web3.PublicKey,
		mintB: web3.PublicKey,
		swapProgramId: web3.PublicKey,
		tokenProgramIdA: web3.PublicKey,
		tokenProgramIdB: web3.PublicKey,
		poolTokenProgramId: web3.PublicKey,
		poolTokenAmount: BN,
		maximumTokenA: BN,
		maximumTokenB: BN,
	): web3.TransactionInstruction {
		const dataLayout = struct([
			u8('instruction'),
			u64('poolTokenAmount'),
			u64('maximumTokenA'),
			u64('maximumTokenB'),
		]);

		const data = Buffer.alloc(dataLayout.span);
		dataLayout.encode(
			{
				instruction: 2, // Deposit instruction
				poolTokenAmount: poolTokenAmount,
				maximumTokenA: maximumTokenA,
				maximumTokenB: maximumTokenB,
			},
			data,
		);

		const keys = [
			{pubkey: tokenSwap, isSigner: false, isWritable: false},
			{pubkey: authority, isSigner: false, isWritable: false},
			{pubkey: userTransferAuthority, isSigner: true, isWritable: false},
			{pubkey: sourceA, isSigner: false, isWritable: true},
			{pubkey: sourceB, isSigner: false, isWritable: true},
			{pubkey: intoA, isSigner: false, isWritable: true},
			{pubkey: intoB, isSigner: false, isWritable: true},
			{pubkey: poolToken, isSigner: false, isWritable: true},
			{pubkey: poolAccount, isSigner: false, isWritable: true},
			{pubkey: mintA, isSigner: false, isWritable: false},
			{pubkey: mintB, isSigner: false, isWritable: false},
			{pubkey: tokenProgramIdA, isSigner: false, isWritable: false},
			{pubkey: tokenProgramIdB, isSigner: false, isWritable: false},
			{pubkey: poolTokenProgramId, isSigner: false, isWritable: false},
		];
		return new web3.TransactionInstruction({
			keys,
			programId: swapProgramId,
			data,
		});
	}

	static withdrawAllTokenTypesInstruction(
		tokenSwap: web3.PublicKey,
		authority: web3.PublicKey,
		userTransferAuthority: web3.PublicKey,
		poolMint: web3.PublicKey,
		feeAccount: web3.PublicKey,
		sourcePoolAccount: web3.PublicKey,
		fromA: web3.PublicKey,
		fromB: web3.PublicKey,
		userAccountA: web3.PublicKey,
		userAccountB: web3.PublicKey,
		mintA: web3.PublicKey,
		mintB: web3.PublicKey,
		swapProgramId: web3.PublicKey,
		poolTokenProgramId: web3.PublicKey,
		tokenProgramIdA: web3.PublicKey,
		tokenProgramIdB: web3.PublicKey,
		poolTokenAmount: number,
		minimumTokenA: number,
		minimumTokenB: number,
	): web3.TransactionInstruction {
		const dataLayout = struct([
			u8('instruction'),
			u64('poolTokenAmount'),
			u64('minimumTokenA'),
			u64('minimumTokenB'),
		]);

		const data = Buffer.alloc(dataLayout.span);
		dataLayout.encode(
			{
				instruction: 3, // Withdraw instruction
				poolTokenAmount: new BN(poolTokenAmount),
				minimumTokenA: new BN(minimumTokenA),
				minimumTokenB: new BN(minimumTokenB),
			},
			data,
		);

		const keys = [
			{pubkey: tokenSwap, isSigner: false, isWritable: false},
			{pubkey: authority, isSigner: false, isWritable: false},
			{pubkey: userTransferAuthority, isSigner: true, isWritable: false},
			{pubkey: poolMint, isSigner: false, isWritable: true},
			{pubkey: sourcePoolAccount, isSigner: false, isWritable: true},
			{pubkey: fromA, isSigner: false, isWritable: true},
			{pubkey: fromB, isSigner: false, isWritable: true},
			{pubkey: userAccountA, isSigner: false, isWritable: true},
			{pubkey: userAccountB, isSigner: false, isWritable: true},
			{pubkey: feeAccount, isSigner: false, isWritable: true},
			{pubkey: mintA, isSigner: false, isWritable: false},
			{pubkey: mintB, isSigner: false, isWritable: false},
			{pubkey: poolTokenProgramId, isSigner: false, isWritable: false},
			{pubkey: tokenProgramIdA, isSigner: false, isWritable: false},
			{pubkey: tokenProgramIdB, isSigner: false, isWritable: false},
		];
		return new web3.TransactionInstruction({
			keys,
			programId: swapProgramId,
			data,
		});
	}

	static depositSingleTokenTypeExactAmountInInstruction(
		tokenSwap: web3.PublicKey,
		authority: web3.PublicKey,
		userTransferAuthority: web3.PublicKey,
		source: web3.PublicKey,
		intoA: web3.PublicKey,
		intoB: web3.PublicKey,
		poolToken: web3.PublicKey,
		poolAccount: web3.PublicKey,
		sourceMint: web3.PublicKey,
		swapProgramId: web3.PublicKey,
		sourceTokenProgramId: web3.PublicKey,
		poolTokenProgramId: web3.PublicKey,
		sourceTokenAmount: bigint,
		minimumPoolTokenAmount: bigint,
	): web3.TransactionInstruction {
		const dataLayout = struct([
			u8('instruction'),
			u64('sourceTokenAmount'),
			u64('minimumPoolTokenAmount'),
		]);

		const data = Buffer.alloc(dataLayout.span);
		dataLayout.encode(
			{
				instruction: 4, // depositSingleTokenTypeExactAmountIn instruction
				sourceTokenAmount: new BN(Number(sourceTokenAmount)),
				minimumPoolTokenAmount: new BN(Number(minimumPoolTokenAmount)),
			},
			data,
		);

		const keys = [
			{pubkey: tokenSwap, isSigner: false, isWritable: false},
			{pubkey: authority, isSigner: false, isWritable: false},
			{pubkey: userTransferAuthority, isSigner: true, isWritable: false},
			{pubkey: source, isSigner: false, isWritable: true},
			{pubkey: intoA, isSigner: false, isWritable: true},
			{pubkey: intoB, isSigner: false, isWritable: true},
			{pubkey: poolToken, isSigner: false, isWritable: true},
			{pubkey: poolAccount, isSigner: false, isWritable: true},
			{pubkey: sourceMint, isSigner: false, isWritable: false},
			{pubkey: sourceTokenProgramId, isSigner: false, isWritable: false},
			{pubkey: poolTokenProgramId, isSigner: false, isWritable: false},
		];
		return new web3.TransactionInstruction({
			keys,
			programId: swapProgramId,
			data,
		});
	}

	static withdrawSingleTokenTypeExactAmountOutInstruction(
		tokenSwap: web3.PublicKey,
		authority: web3.PublicKey,
		userTransferAuthority: web3.PublicKey,
		poolMint: web3.PublicKey,
		feeAccount: web3.PublicKey,
		sourcePoolAccount: web3.PublicKey,
		fromA: web3.PublicKey,
		fromB: web3.PublicKey,
		userAccount: web3.PublicKey,
		destinationMint: web3.PublicKey,
		swapProgramId: web3.PublicKey,
		poolTokenProgramId: web3.PublicKey,
		destinationTokenProgramId: web3.PublicKey,
		destinationTokenAmount: bigint,
		maximumPoolTokenAmount: bigint,
	): web3.TransactionInstruction {
		const dataLayout = struct([
			u8('instruction'),
			u64('destinationTokenAmount'),
			u64('maximumPoolTokenAmount'),
		]);

		const data = Buffer.alloc(dataLayout.span);
		dataLayout.encode(
			{
				instruction: 5, // withdrawSingleTokenTypeExactAmountOut instruction
				destinationTokenAmount: new BN(Number(destinationTokenAmount)),
				maximumPoolTokenAmount: new BN(Number(maximumPoolTokenAmount)),
			},
			data,
		);

		const keys = [
			{pubkey: tokenSwap, isSigner: false, isWritable: false},
			{pubkey: authority, isSigner: false, isWritable: false},
			{pubkey: userTransferAuthority, isSigner: true, isWritable: false},
			{pubkey: poolMint, isSigner: false, isWritable: true},
			{pubkey: sourcePoolAccount, isSigner: false, isWritable: true},
			{pubkey: fromA, isSigner: false, isWritable: true},
			{pubkey: fromB, isSigner: false, isWritable: true},
			{pubkey: userAccount, isSigner: false, isWritable: true},
			{pubkey: feeAccount, isSigner: false, isWritable: true},
			{pubkey: destinationMint, isSigner: false, isWritable: false},
			{pubkey: poolTokenProgramId, isSigner: false, isWritable: false},
			{pubkey: destinationTokenProgramId, isSigner: false, isWritable: false},
		];
		return new web3.TransactionInstruction({
			keys,
			programId: swapProgramId,
			data,
		});
	}
}
