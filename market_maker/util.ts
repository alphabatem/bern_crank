import axios from "axios";
import {TokenSwapLayout} from "../token_swap/layouts";
import {web3} from "@project-serum/anchor";


export const SWAP_PROGRAM_ID = new web3.PublicKey("FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X")

export function loadWalletKey(keypairFile: string): web3.Keypair {
	if (!keypairFile || keypairFile == '') {
		throw new Error('Keypair is required!');
	}
	const fs = require("fs");
	const loaded = web3.Keypair.fromSecretKey(
		new Uint8Array(JSON.parse(fs.readFileSync(keypairFile).toString())),
	);
	return loaded;
}

//Converts array into chunked array
export function chunkArray(myArray, chunk_size) {
	let results = [];

	while (myArray.length) {
		results.push(myArray.splice(0, chunk_size));
	}

	return results;
}

//Get token holders from fluxbeam
export async function getAllTokenHolders(mint) {
	let page = 0;
	let currentHolders = [];
	let moreResults = true;
	while (moreResults) {
		const resp = await axios.get(`https://api.fluxbeam.xyz/v1/tokens/${mint}/holders?page=${page}&limit=300`);
		if (resp.data.length === 0) {
			moreResults = false;
		} else {
			currentHolders = currentHolders.concat(resp.data);
			page++;
		}
	}
	return currentHolders;
}


/**
 * Returns the token balance for a given token account
 *
 * @param connection
 * @param tokenAccount
 */
export async function getTokenBalance(connection: web3.Connection, tokenAccount): Promise<number> {
	const resp = await connection.getTokenAccountBalance(tokenAccount, "confirmed")
	return Number(resp.value.amount)
}

/**
 * Buys tokenB with exactIn of tokenA
 * Uses Jup.ag V5 swap for getting best price
 * @param connection
 * @param owner
 * @param tokenA
 * @param tokenB
 * @param tokenAAmount
 * @param slippage
 */
async function buyTokenAmount(connection: web3.Connection, owner: web3.Keypair, tokenA: web3.PublicKey, tokenB: web3.PublicKey, tokenAAmount, slippage: number) {
	const uri = `https://quote-api.jup.ag/v5/quote?inputMint=${tokenA}&outputMint=${tokenB}&amount=${tokenAAmount}&slippageBps=${slippage}&userPublicKey=${owner.publicKey}`
	const quote = await axios.get(uri)

	const body = {
		quoteResponse: quote.data,
		userPublicKey: owner.publicKey,
		wrapUnwrapSOL: true,
	}

	const transactions = await axios.post('https://quote-api.jup.ag/v5/swap', JSON.stringify(body), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
	});

	//@ts-ignore
	const {swapTransaction} = transactions.data;
	const txn = web3.VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'))
	txn.sign([owner])

	const sig = await connection.sendTransaction(txn)

	const latestBlockHash = await connection.getLatestBlockhash();
	await connection.confirmTransaction({
		signature: sig,
		blockhash: txn.message.recentBlockhash,
		lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
	})

	console.log("XFER Sig: ", sig)

	//@ts-ignore
	return quote.data.outAmount
}

//Gets the swap pools for liquidity providers
export async function getSwapPools(connection, mint) {
	const resp = await connection.getProgramAccounts(SWAP_PROGRAM_ID, {
		commitment: 'confirmed',
		filters: [
			{
				memcmp: {
					offset: 1 + 1 + 1 + 32 + 32 + 32 + 32,
					bytes: mint.toString(),
				},
			},
		],
	})
	const respInverse = await connection.getProgramAccounts(SWAP_PROGRAM_ID, {
		commitment: 'confirmed',
		filters: [
			{
				memcmp: {
					offset: 1 + 1 + 1 + 32 + 32 + 32 + 32 + 32,
					bytes: mint.toString(),
				},
			},
		],
	})
	return resp.concat(respInverse).map((m) => {
		return {pubkey: m.pubkey, account: TokenSwapLayout.decode(m.account.data)}
	})
}

export async function getPool(connection: web3.Connection, pool: web3.PublicKey) {
	const resp = await connection.getAccountInfo(pool)
	return {pubkey: pool, owner: resp?.owner, account: TokenSwapLayout.decode(resp!.data)}
}