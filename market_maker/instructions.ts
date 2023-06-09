//Transfer token mint to dst for given transferAmount
import {createBurnCheckedInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID} from "@solana/spl-token";
import {web3} from "@project-serum/anchor";
import {TokenInput} from "../token_swap/layouts";
import {getSwapPools} from "./util";
import Client from "../token_swap/client";

export function transferTokenAmountInstruction(
	owner: web3.PublicKey,
	dst: web3.PublicKey,
	mint: web3.PublicKey,
	transferAmount: number,
	decimals: number,
	programID = TOKEN_PROGRAM_ID
) {
	const dstAta = getAssociatedTokenAddressSync(mint, dst, false, programID)
	const srcAta = getAssociatedTokenAddressSync(mint, owner, false, programID)
	const ix = createTransferCheckedInstruction(srcAta, mint, dstAta, owner, transferAmount, decimals, [], programID)
	return {ix, dstAta}
}

//Burn SPLv1 tokens
export async function burnTokenAmountInstruction(
	owner: web3.PublicKey,
	mint: web3.PublicKey,
	burnAmount: number,
	decimals: number,
	programID = TOKEN_PROGRAM_ID
) {
	const burnAta = getAssociatedTokenAddressSync(mint, owner, false)

	return createBurnCheckedInstruction(burnAta, mint, owner, burnAmount, decimals, [], programID)
}

/**
 * Swaps via FluxBeam for a minOutAmount
 *
 * @param connection
 * @param owner
 * @param tokenA
 * @param tokenB
 * @param tokenAAmount
 * @param minAmountOut
 */
export async function getAndSwapFluxbeamPool(connection: web3.Connection, owner: web3.PublicKey, tokenA: TokenInput, tokenB: TokenInput, tokenAAmount, minAmountOut = 0) {
	console.log(`Getting swap pool - ${tokenA.mint} -> ${tokenB.mint}`)
	const pools = await getSwapPools(tokenA.mint, tokenB.mint)
	if (!pools) {
		console.log(`No FluxBeam pools ${tokenA.mint} -> ${tokenB.mint}`)
		return
	}

	const pool = pools[0]

	return swapFluxbeamPool(connection, owner, pool, tokenA, tokenB, tokenAAmount, minAmountOut)
}

/**
 * Swaps via FluxBeam for a minOutAmount
 *
 * @param connection
 * @param owner
 * @param pool
 * @param tokenA
 * @param tokenB
 * @param tokenAAmount
 * @param minAmountOut
 */
export async function swapFluxbeamPool(connection: web3.Connection, owner: web3.PublicKey, pool, tokenA: TokenInput, tokenB: TokenInput, tokenAAmount, minAmountOut = 0) {
	const client = new Client(connection)
	return await client.createSwapTransaction(
		owner,
		pool.pubkey,
		tokenA,
		tokenB,
		pool.account,
		//@ts-ignore
		Math.floor(tokenAAmount).toString(),
		Math.floor(minAmountOut).toString()
	)
}