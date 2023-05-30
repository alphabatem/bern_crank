import * as anchor from "@project-serum/anchor";
import Client from "./token_swap/client";
import {
	AccountLayout,
	createAssociatedTokenAccountInstruction,
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
	const skipPreflight = true;

	const WSOL = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112")
	const USDC = new anchor.web3.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")

	//Set Token Mint
	// let tokenMint = new anchor.web3.PublicKey("4rADWie1EB5k2Dd49oM1SfeNawTRtV2ZTyutFb3B57nG");
	let tokenMint = new anchor.web3.PublicKey("FdkGacJRQLorEUVewJjtc9xkupbAVeAKNAzNeHhr91XD");

	//Set the token to route through
	let intermediaryMint = USDC

	//Set to burn BONK
	let tokenBurnMint = new anchor.web3.PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");

	//DAO Address (.1%)
	const daoAddress = new anchor.web3.PublicKey("DBR2ZUvjZTcgy6R9US64t96pBEZMyr9DPW6G2scrctQK")

	//Dev Address (.3%)
	const devAddress = new anchor.web3.PublicKey("AZRMSXfBrGwpWHLC2ZPnbs4YdGD5ezvS1eAyDyRWt1E2")

	//Set fee authority owner
	// const owner = loadWalletKey("./keypair.json")
	const owner = loadWalletKey("./TestBp2mbAfJC27E4N7TGKZwzoYxuLiEahYcsrXmPhQ.json")


	//Enter RPC URL
	const connection = new Connection("https://rpc.hellomoon.io/f197c876-52d7-4566-bc4c-af4405029777", "confirmed")

	const swapClient = new Client(connection)

	//Enter slippage for token swap
	const slippage = 50;

	//Token mint info
	let mintInfo;

	//Token mint program
	let mintProgram: anchor.web3.PublicKey;

	//Token burn mint info
	let burnMintInfo;

	//Current holders of the token mint
	let currentHolders;

	//Associated token account for the owner
	let ata: anchor.web3.PublicKey;

	it('Gets the required token info', async () => {
		//Token mint info
		mintInfo = await connection.getParsedAccountInfo(tokenMint, "confirmed")
		mintProgram = new anchor.web3.PublicKey(mintInfo.value.owner)
		mintInfo = mintInfo.value.data.parsed.info

		//Token burn mint info
		burnMintInfo = await connection.getParsedAccountInfo(tokenBurnMint, "confirmed")
		burnMintInfo = burnMintInfo.value.data.parsed.info

		//Owner authority token account
		ata = getAssociatedTokenAddressSync(tokenMint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID)
		console.log("ATA:", ata.toString())

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

		const bhash = await connection.getLatestBlockhash("confirmed")
		txn.feePayer = owner.publicKey
		txn.recentBlockhash = bhash.blockhash


		const sig = await sendAndConfirmTransaction(connection, txn, [owner], {skipPreflight: skipPreflight});
		console.log("Reclaim Signature: ", sig)
	})

	it('Transfers allocated amount to holders', async () => {
		const currentTokenBalance = await getTokenBalance(ata)
		console.log("Token Balance", currentTokenBalance)
		if (currentTokenBalance <= 0) {
			console.log("No tokens to distribute: ", currentTokenBalance)
			return
		}

		//Calculate percentages based on our 6.9% split
		const daoPct = 0.1 / 6.9
		const devPct = 0.3 / 6.9
		const burnPct = 1.5 / 6.9
		const reflectPct = 5 / 6.9

		// console.log("Percentages", {
		// 	daoPct,
		// 	devPct,
		// 	burnPct,
		// 	reflectPct
		// })

		//6.9% Fee comes into our `owner` wallet from FeeConfig

		//Send 0.1% to BONK DAO
		const daoAmount = Math.floor(currentTokenBalance * daoPct)
		const {ix: daoIx, dstAta: daoAta} = await transferTokenAmountInstruction(daoAddress, tokenMint, daoAmount, mintProgram)

		//Send 0.3% to Dev Wallet
		const devAmount = Math.floor(currentTokenBalance * devPct)
		const {ix: devIx, dstAta: devAta} = await transferTokenAmountInstruction(devAddress, tokenMint, devAmount, mintProgram)

		const daoAtaInfo = await connection.getParsedAccountInfo(daoAta, "confirmed")
		const devAtaInfo = await connection.getParsedAccountInfo(devAta, "confirmed")

		let txn = new anchor.web3.Transaction()

		if (!daoAtaInfo.value)
		txn.add(createAssociatedTokenAccountInstruction(owner.publicKey, daoAta, daoAddress, tokenMint, mintProgram))
		if (!devAtaInfo.value)
		txn.add(createAssociatedTokenAccountInstruction(owner.publicKey, devAta, devAddress, tokenMint, mintProgram))

		//Add our transfer commands
		txn.add(daoIx)
		txn.add(devIx)

		console.log("CORE Sending DAO & Dev allocation...")
		const sig = await sendAndConfirmTransaction(connection, txn, [owner], {skipPreflight: skipPreflight});
		console.log("CORE XFER Sig: ", sig)


		//Send 1.5% to buy BONK to BURN
		const burnAmount = Math.floor(currentTokenBalance * burnPct)
		console.log(`BURN <-     ${burnAmount} (${burnPct}%)`)
		await burnTokens(burnAmount)

		//Send 5% to buy BONK to REFLECT
		const reflectAmount = currentTokenBalance * reflectPct
		console.log(`REFLECT <-  ${reflectAmount} (${reflectPct}%)`)

		const reflectionPerToken = reflectAmount / mintInfo.supply
		console.log(`Token Reflection: ${reflectionPerToken}`)
		await reflectToHolders(reflectionPerToken)


		console.log("Dust", currentTokenBalance - daoAmount - devAmount - burnAmount - reflectAmount)
	})


	async function burnTokens(burnAmount: number) {
		console.log(`Burning ${burnAmount} Tokens`)
		const txn = new anchor.web3.Transaction()

		//Swap tokens to our intermediary SPLv1 Token
		const intermediaryAmount = await swapFluxbeamPool(
			new TokenInput(tokenMint, 0),
			new TokenInput(intermediaryMint, 0, TOKEN_PROGRAM_ID),
			burnAmount
		)

		if (!intermediaryAmount) {
			console.error(`Unable to swap on fluxbeam ${tokenMint} -> ${intermediaryMint}`)
			return
		}
		console.log(`Received ${intermediaryAmount} of ${intermediaryMint}`)

		//Swap Intermediary for the burn token mint
		const burnTokenAmount = await buyTokenAmountInstruction(intermediaryMint, tokenBurnMint, intermediaryAmount)

		//Burn the Burn tokens
		txn.add(await burnTokenAmountInstruction(tokenBurnMint, burnTokenAmount))

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

	async function getTokenBalance(tokenAccount): Promise<number> {
		const resp = await connection.getTokenAccountBalance(tokenAccount, "confirmed")
		return Number(resp.value.amount)
	}


	async function reflectToHolders(amountPerToken) {
		const src = getAssociatedTokenAddressSync(tokenMint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID)
		let txn = new anchor.web3.Transaction()

		for (let i = 0; i < currentHolders.length; i++) {
			const holder = currentHolders[i]

			const totalAmount = Math.floor(holder.amount * amountPerToken)

			txn.add(createTransferCheckedInstruction(src, tokenMint, new anchor.web3.PublicKey(holder.address), owner.publicKey, totalAmount, mintInfo.decimals, mintProgram))

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
		const txn = anchor.web3.VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'))


		txn.sign([owner])

		const sig = await connection.sendTransaction(txn, {
			skipPreflight: skipPreflight,
			preflightCommitment: "confirmed"
		})

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

	async function swapFluxbeamPool(tokenA: TokenInput, tokenB: TokenInput, tokenAAmount, minAmountOut = 0) {
		console.log(`Getting swap pool - ${tokenA.mint} -> ${tokenB.mint}`)
		const pools = await swapClient.getSwapPools(tokenA.mint, tokenB.mint)
		const route = pools[0]
		if (!route) {
			throw new Error("No pools for swap input")
		}

		const dstAta = getAssociatedTokenAddressSync(tokenB.mint, owner.publicKey, false, tokenB.programID)
		const preBalance = await connection.getTokenAccountBalance(dstAta, "confirmed")
		console.debug("preBalance", preBalance?.value.amount)

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


		const postBalance = await connection.getTokenAccountBalance(dstAta, "confirmed")
		console.debug("postBalance", postBalance?.value.amount, Number(postBalance?.value.amount) - Number(preBalance?.value.amount))

		return Number(postBalance?.value.amount) - Number(preBalance?.value.amount)
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
	async function transferTokenAmountInstruction(dst, mint, transferAmount, programID = TOKEN_PROGRAM_ID) {
		const dstAta = getAssociatedTokenAddressSync(mint, dst, false, programID)
		const srcAta = getAssociatedTokenAddressSync(mint, owner.publicKey, false, programID)
		const ix = createTransferCheckedInstruction(srcAta, tokenMint, dstAta, owner.publicKey, transferAmount, mintInfo.decimals, [], programID)
		return {ix, dstAta}
	}

	//Burn SPLv1 tokens
	async function burnTokenAmountInstruction(mint, burnAmount, programID = TOKEN_PROGRAM_ID) {
		const burnAta = getAssociatedTokenAddressSync(mint, owner.publicKey, false)

		return createBurnCheckedInstruction(burnAta, mint, owner.publicKey, burnAmount, burnMintInfo.decimals, [], programID)
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