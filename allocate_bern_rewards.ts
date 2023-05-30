import * as anchor from "@project-serum/anchor";
import Client from "./token_swap/client";
import {
	AccountLayout, burn,
	createBurnCheckedInstruction,
	createTransferCheckedInstruction,
	createWithdrawWithheldTokensFromAccountsInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import {AddressLookupTableProgram, Connection, sendAndConfirmTransaction} from "@solana/web3.js";
import axios from "axios";
import {TokenInput} from "./token_swap/layouts";

describe("$BERN Reward allocation", () => {
	// Configure the client to use the local cluster.
	const skipPreflight = false;

	const WSOL = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112")

	//Set Token Mint
	let tokenMint = new anchor.web3.PublicKey("4rADWie1EB5k2Dd49oM1SfeNawTRtV2ZTyutFb3B57nG");

	//Set to burn BONK
	let tokenBurnMint = new anchor.web3.PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");

	//DAO Address (.1%)
	const daoAddress = new anchor.web3.PublicKey("DBR2ZUvjZTcgy6R9US64t96pBEZMyr9DPW6G2scrctQK")

	//Dev Address (.3%)
	const devAddress = new anchor.web3.PublicKey("AZRMSXfBrGwpWHLC2ZPnbs4YdGD5ezvS1eAyDyRWt1E2")

	//Set fee authority owner
	const owner = loadWalletKey("./keypair.json")


	//Enter RPC URL
	const connection = new Connection("https://rpc.hellomoon.io/{KEY}", "confirmed")

	const swapClient = new Client(connection)

	//Enter slippage for token swap
	const slippage = 5;

	//Token mint info
	let mintInfo;

	//Current holders of the token mint
	let currentHolders;

	//Associated token account for the owner
	let ata: anchor.web3.PublicKey;

	it('Gets the required token info', async () => {
		//Token mint info
		mintInfo = await connection.getParsedAccountInfo(tokenMint, "confirmed")
		mintInfo = mintInfo.value.data.parsed.info

		//Owner authority token account
		ata = getAssociatedTokenAddressSync(tokenMint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID)

		// currentHolders = await getTokenAccountsByMint(tokenMint);
		currentHolders = await getAllTokenHolders();
		console.log("Current Holders", currentHolders.length)
	});

	it('Reclaims fees from accounts', async () => {

		const txn = new anchor.web3.Transaction()

		//TODO this needs chunking
		const holderArr = currentHolders.map(h => new anchor.web3.PublicKey(h.address))

		txn.add(createWithdrawWithheldTokensFromAccountsInstruction(
			tokenMint,
			ata,
			owner.publicKey,
			[],
			holderArr,
			TOKEN_2022_PROGRAM_ID
		))

		const sig = await sendAndConfirmTransaction(connection, txn, [owner], {skipPreflight: skipPreflight});
		console.log("Reclaim Signature: ", sig)
	})

	it('Transfers allocated amount to holders', async () => {
		const currentTokenBalance = await getTokenBalance(ata)
		console.log("Token Balance", currentTokenBalance)

		//Calculate percentages based on our 6.9% split
		const daoPct = 0.1 / 6.9
		const devPct = 0.3 / 6.9
		const burnPct = 1.5 / 6.9
		const reflectPct = 5 / 6.9

		console.log("Percentages", {
			daoPct,
			devPct,
			burnPct,
			reflectPct
		})

		//6.9% Fee comes into our `owner` wallet from FeeConfig

		//Send 0.1% to BONK DAO
		const daoAmount = Math.floor(currentTokenBalance * daoPct)
		console.log(`XFER -> DAO ${daoAmount} (${daoPct}%)`)
		const daoIx = await transferTokenAmountInstruction(daoAddress, tokenMint, daoAmount)

		//Send 0.3% to Dev Wallet
		const devAmount = Math.floor(currentTokenBalance * devPct)
		console.log(`XFER -> DEV ${devAmount} (${devPct}%)`)
		const devIx = await transferTokenAmountInstruction(devAddress, tokenMint, devAmount)


		//Send 1.5% to buy BONK to BURN
		const burnAmount = Math.floor(currentTokenBalance * burnPct)
		console.log(`BURN <-     ${burnAmount} (${burnPct}%)`)

		await burnTokens(burnAmount)


		let txn = new anchor.web3.Transaction()
		txn.add(daoIx)
		txn.add(devIx)

		const sig = await sendAndConfirmTransaction(connection, txn, [owner], {skipPreflight: skipPreflight});
		console.log("CORE XFER Sig: ", sig)


		//Send 5% to buy BONK to REFLECT
		const reflectAmount = currentTokenBalance * reflectPct
		console.log(`REFLECT <-  ${reflectAmount} (${reflectPct}%)`)

		const reflectionPerToken = reflectAmount / mintInfo.supply
		console.log(`Token Reflection: ${reflectionPerToken}`)
		await reflectToHolders(reflectionPerToken)


		console.log("Dust", currentTokenBalance - daoAmount - devAmount - burnAmount - reflectAmount)
	})


	async function burnTokens(burnAmount: number) {
		const txn = new anchor.web3.Transaction()

		//TODO Buy BONK To Burn first
		//Swap BERN Tokens for SOL
		const wSOLAmount = await swapFluxbeamPool(
			new TokenInput(WSOL, 0, TOKEN_PROGRAM_ID),
			new TokenInput(tokenBurnMint, 0),
			burnAmount
		)

		//Swap SOL for BONK
		const bonkAmount = await buyTokenAmountInstruction(WSOL, tokenBurnMint, wSOLAmount)

		//Burn BONK
		txn.add(await burnTokenAmountInstruction(tokenMint, bonkAmount))

		const sig = await sendAndConfirmTransaction(connection, txn, [owner], {skipPreflight: skipPreflight});
		console.log("Burn Sig: ", sig)
	}

	async function getAllTokenHolders() {
		let page = 0;
		let currentHolders = [];
		let moreResults = true;
		while (moreResults) {
			const resp = await axios.get(`https://api.fluxbeam.xyz/v1/tokens/${tokenMint}/holders?page=${page}&limit=1000`);
			if (resp.data.length === 0) {
				moreResults = false;
			} else {
				currentHolders = currentHolders.concat(resp.data);
				page++;
			}
		}
		return currentHolders;
	}

	async function getTokenBalance(mint): Promise<number> {
		const resp = await connection.getTokenAccountBalance(mint, "confirmed")
		return Number(resp.value.amount)
	}


	async function reflectToHolders(amountPerToken) {
		const src = getAssociatedTokenAddressSync(tokenMint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID)
		let txn = new anchor.web3.Transaction()

		for (let i = 0; i < currentHolders.length; i++) {
			const holder = AccountLayout.decode(currentHolders[i].account.data)
			console.log("holderAcc", holder)

			const totalAmount = holder.amount * amountPerToken
			console.log(`XFER -> DEV ${totalAmount} (${holder.amount} x ${amountPerToken})`)

			// txn.add(createAssociatedTokenAccountInstruction(owner.publicKey, ata, holder, tokenMint)) //They must have a ATA created already - we dont pay fees
			txn.add(createTransferCheckedInstruction(src, tokenMint, ata, owner.publicKey, totalAmount, mintInfo.decimals))

			//TODO Calculate amount of xfers we can do per txn
			if (txn.instructions.length > 18) {
				const sig = await sendAndConfirmTransaction(connection, txn, [owner], {skipPreflight: skipPreflight});
				console.log("XFER Sig: ", sig)

				//Reset txn for next round
				txn = new anchor.web3.Transaction()
			}
		}

		//Finish any pending txns
		if (txn.instructions.length > 0) {
			const sig = await sendAndConfirmTransaction(connection, txn, [owner], {skipPreflight: skipPreflight});
			console.log("XFER Sig: ", sig)
		}
	}

	/**
	 * Buys tokenB with exactIn of tokenA
	 * Uses Jup.ag V5 swap for getting best price
	 * @param tokenA
	 * @param tokenB
	 * @param tokenAAmount
	 */
	async function buyTokenAmountInstruction(tokenA: anchor.web3.PublicKey, tokenB: anchor.web3.PublicKey, tokenAAmount) {
		const quote = await axios.get(`https://quote-api.jup.ag/v5/quote?inputMint=${tokenA}&outputMint=${tokenB}&amount=${tokenAAmount}&slippageBps=${slippage}&userPublicKey=${owner.publicKey}`)

		const transactions = await axios.post('https://quote-api.jup.ag/v5/swap', JSON.stringify(quote), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
		});

		//@ts-ignore
		const {swapTransaction} = transactions;
		const txn = anchor.web3.VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'))

		//@ts-ignore
		return {txn, outAmount: quote.outAmount}
	}

	async function swapFluxbeamPool(tokenA: TokenInput, tokenB: TokenInput, tokenAAmount, minAmountOut = 0) {
		const pools = await swapClient.getSwapPools(tokenA.mint, tokenB.mint)
		const route = pools[0]

		const txn = await swapClient.createSwapTransaction(
			owner.publicKey,
			route.pubkey,
			tokenA,
			tokenB,
			route.account,
			//@ts-ignore
			Math.floor(tokenAAmount).toString(),
			Math.floor(minAmountOut).toString()
		)

		const sig = await sendAndConfirmTransaction(connection, txn, [owner], {skipPreflight: skipPreflight});

		console.log("Swap Sig: ", sig)

		return minAmountOut //TODO
	}

	//Create a new LUT
	async function createAddressTableInstruction(table: anchor.web3.PublicKey, recentSlot = 0) {
		if (recentSlot === 0) {
			recentSlot = await connection.getSlot("confirmed")
		}

		return AddressLookupTableProgram.createLookupTable({
			authority: owner.publicKey,
			payer: owner.publicKey,
			recentSlot: recentSlot
		})
	}

	//Extend a new LUT
	async function extendAddressTableInstruction(table: anchor.web3.PublicKey, addresses: anchor.web3.PublicKey[]) {
		return AddressLookupTableProgram.extendLookupTable({
			lookupTable: table,
			authority: owner.publicKey,
			payer: owner.publicKey,
			addresses: addresses,
		})
	}


	//Dispose of a LUT
	function closeAddressTableInstruction(table: anchor.web3.PublicKey) {
		return AddressLookupTableProgram.closeLookupTable({
			authority: owner.publicKey,
			lookupTable: table,
			recipient: owner.publicKey
		})
	}

	//Transfer token mint to dst for given transferAmount
	async function transferTokenAmountInstruction(dst, mint, transferAmount) {
		return createTransferCheckedInstruction(ata, tokenMint, dst, owner.publicKey, transferAmount, mintInfo.decimals)
	}

	//Burn SPLv1 tokens
	async function burnTokenAmountInstruction(mint, burnAmount, programID = TOKEN_PROGRAM_ID) {
		return createBurnCheckedInstruction(ata, mint, owner.publicKey, burnAmount, mintInfo.decimals, [], programID)
	}

	function loadWalletKey(keypairFile: string): anchor.web3.Keypair {
		if (!keypairFile || keypairFile == '') {
			throw new Error('Keypair is required!');
		}
		const fs = require("fs");
		const loaded = anchor.web3.Keypair.fromSecretKey(
			new Uint8Array(JSON.parse(fs.readFileSync(keypairFile).toString())),
		);
		return loaded;
	}
})