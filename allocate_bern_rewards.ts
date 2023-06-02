import * as anchor from "@project-serum/anchor";
import Client from "./token_swap/client";
import {
	createAssociatedTokenAccountInstruction,
	createBurnCheckedInstruction,
	createCloseAccountInstruction,
	createTransferCheckedInstruction,
	createWithdrawWithheldTokensFromAccountsInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import {AddressLookupTableAccount, AddressLookupTableProgram, Connection, sendAndConfirmTransaction, SystemProgram} from "@solana/web3.js";
import axios from "axios";
import {TokenInput, TokenSwapLayout} from "./token_swap/layouts";
import fs from "fs";

describe("$BERN Reward allocation", () => {
	// Configure the client to use the local cluster.
	const skipPreflight = true;

	const WSOL = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112")
	const USDC = new anchor.web3.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")

	const SWAP_PROGRAM_ID = new anchor.web3.PublicKey("FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X")

	//Set Token Mint
	// let tokenMint = new anchor.web3.PublicKey("CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo");
	let tokenMint = new anchor.web3.PublicKey("EJnCTVdGkYocPpei7rjTcuiWPkretrku8N1wvuvfL99F");
	let tokenInput = new TokenInput(tokenMint, 0, TOKEN_2022_PROGRAM_ID);

	//Set the token to route through
	let intermediaryMint = WSOL
	let intermediaryInput = new TokenInput(intermediaryMint, 0, TOKEN_PROGRAM_ID);

	//Set the token mint to distribute to holders of tokenMint
	let reflectionMint = WSOL
	let reflectionInput = new TokenInput(intermediaryMint, 0, TOKEN_PROGRAM_ID);

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

	//Fee percentage for the token mint
	const feePct = 6.9;

	//Token mint info
	let mintInfo;

	//Token mint program
	let mintProgram: anchor.web3.PublicKey;

	//Token burn mint info
	let burnMintInfo;

	//Current holders of the token mint
	let currentHolders;

	//Holds pool -> LP Holders[]
	const lpProviderMap = {}

	//Holds LP Token accounts -> Pool Address
	const lpAccountToPoolMap = {}

	//Associated token account for the owner
	let ata: anchor.web3.PublicKey;

	//Holds the queue of transactions to send
	let executionQueue = [];

	//Holds the queue of failed transactions
	let failedQueue = [];

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

		await buildLPProviderMaps()
		console.log("LP Pools: ", Object.keys(lpAccountToPoolMap).length)
	});


	/**
	 * Runs through all holders and reclaims any withheld tokens they have
	 */
	it('Reclaims fees from accounts', async () => {
		const holderArr = currentHolders.filter(h => h.amount > 0).map(h => new anchor.web3.PublicKey(h.address))
		console.log("Holders with > 0 Balance: ", holderArr.length)

		// Split holderArr into batches
		const holderArrChunks = chunkArray(holderArr, 20);

		// Loop through batches & create the withdraw IX
		for (const chunk of holderArrChunks) {
			const txn = new anchor.web3.Transaction()
			txn.add(createWithdrawWithheldTokensFromAccountsInstruction(
				tokenMint,
				ata,
				owner.publicKey,
				[],
				chunk,
				TOKEN_2022_PROGRAM_ID
			))

			const bhash = await connection.getLatestBlockhash("confirmed")
			txn.feePayer = owner.publicKey
			txn.recentBlockhash = bhash.blockhash

			const sig = await sendAndConfirmTransaction(connection, txn, [owner], {skipPreflight: skipPreflight});
			console.log("Reclaim Signature: ", sig)
		}
	})


	/**
	 * Allocate the reclaimed fees to the various endpoints
	 * - Dev & Dao Allocation
	 * - Burn Bonk
	 * - Reflect to Users
	 */
	it('Transfers allocated amount to holders', async () => {
		const currentTokenBalance = await getTokenBalance(ata)
		console.log("Token Balance", currentTokenBalance)
		if (currentTokenBalance <= 0) {
			console.log("No tokens to distribute: ", currentTokenBalance)
			return
		}

		//Calculate percentages based on our {feePct}% split
		const daoPct = 0.1 / feePct
		const devPct = 0.3 / feePct
		const burnPct = 1.5 / feePct
		const reflectPct = 5 / feePct

		//{feePct}% Fee comes into our `owner` wallet from FeeConfig

		//Send 0.4% to Dao & Dev wallet (0.1/0.3)
		const daoAmount = Math.floor(currentTokenBalance * daoPct)
		const devAmount = Math.floor(currentTokenBalance * devPct)
		console.log(`ALLOCATE <-  DAO: ${daoAmount} (${daoPct}%) - DEV: ${devAmount} (${devPct}%)`)
		await buildDevDaoAllocationTransaction(daoAmount, devAmount)


		//Send 1.5% to buy BONK to BURN
		const burnAmount = Math.floor(currentTokenBalance * burnPct)
		console.log(`BURN <-     ${burnAmount} (${burnPct}%)`)
		await burnTokens(burnAmount)

		//Send 5% to buy SOL to REFLECT
		const reflectAmount = currentTokenBalance * reflectPct
		console.log(`REFLECT <-  ${reflectAmount} (${reflectPct}%)`)
		await reflectToHolders(reflectAmount)

		console.log("Dust", currentTokenBalance - daoAmount - devAmount - burnAmount - reflectAmount)
	})

	/**
	 * Attempt to send across all transactions build up previously
	 * - Dev & Dao Allocations
	 * - Bonk Burn
	 * - SOL Reflection
	 */
	it('Executes the allocation transactions', async () => {
		console.log(`Executing ${executionQueue.length} transactions...`)
		await processQueue(executionQueue)
	});

	/**
	 * Retry any failed transactions during the process
	 */
	it('Resends failed transactions', async () => {
		console.log(`Retrying ${failedQueue.length} failed transactions...`)
		await processQueue(failedQueue, false)
	});

	/**
	 * Builds the transfer transaction for allocation to dev & dao wallets
	 *
	 * @param daoAmount
	 * @param devAmount
	 */
	async function buildDevDaoAllocationTransaction(daoAmount, devAmount) {
		console.log(`BUILD: Send Dev & Dao Allocation`)

		//Send 0.1% to BONK DAO
		const {ix: daoIx, dstAta: daoAta} = await transferTokenAmountInstruction(daoAddress, tokenMint, daoAmount, mintProgram)

		//Send 0.3% to Dev Wallet
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

		executionQueue.push(txn)
	}

	/**
	 * Burns a given amount of tokenBurnMint tokens by first swapping through fluxbeam & then through jup for v2 tokens
	 *
	 * @param burnAmount
	 */
	async function burnTokens(burnAmount: number) {
		console.log(`BUILD: Burning ${burnAmount} Tokens`)
		const txn = new anchor.web3.Transaction()

		//Swap tokens to our intermediary SPLv1 Token
		const intermediaryAmount = await swapFluxbeamPool(
			tokenInput, //Input token
			intermediaryInput, //Output token
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

		executionQueue.push(txn)
	}

	/**
	 * Returns all token holders for a given token mint
	 */
	async function getAllTokenHolders() {
		console.log(`Getting all token holders for mint: ${tokenMint}`)
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

	/**
	 * Returns the token balance for a given token account
	 *
	 * @param tokenAccount
	 */
	async function getTokenBalance(tokenAccount): Promise<number> {
		const resp = await connection.getTokenAccountBalance(tokenAccount, "confirmed")
		return Number(resp.value.amount)
	}

	/**
	 * Attempts to send all built transactions & optionally reschedules onto failed queue
	 *
	 * @param queue
	 * @param addFailed
	 */
	async function processQueue(queue, addFailed = true) {
		for (let i = 0; i < queue.length; i++) {
			const txn = queue[i]
			const sig = await sendAndConfirmTransaction(connection, txn, [owner], {skipPreflight: skipPreflight}).catch(e => {
				console.error("TXN failed: ", e)
				if (addFailed)
					failedQueue.push(txn)
			});
			console.log(`TXN ${i}:`, sig)
		}
	}

	/**
	 * Sends SOL to all token holders
	 * @param startIndex
	 * @param endIndex
	 * @param currentHolders
	 * @param amountPerToken
	 * @param src
	 */
	async function processBatchSOL(startIndex, endIndex, currentHolders, amountPerToken) {
		let txn = new anchor.web3.Transaction()
		let list = []

		//Unwrap our SOL
		// txn.add(createCloseAccountInstruction(getAssociatedTokenAddressSync(WSOL, owner.publicKey, false), owner.publicKey, owner.publicKey, []))

		for (let i = startIndex; i < endIndex; i++) {
			const holder = currentHolders[i];
			if (holder.amount <= 0)
				continue

			if (lpAccountToPoolMap[holder.address]) {
				//Pool account - Split allocation & allocate across the lp providers for the pool
				const lpHolders = lpProviderMap[lpAccountToPoolMap[holder.address]]
				for (let i = 0; i < lpHolders.length; i++) {
					const totalAmount = Math.floor(holder.amount * lpHolders[i].pct) * amountPerToken

					txn.add(SystemProgram.transfer({
						fromPubkey: owner.publicKey,
						toPubkey: new anchor.web3.PublicKey(lpHolders[i].address),
						lamports: totalAmount,
					}))

					list.push({address: lpHolders[i].address, amount: totalAmount, original_address: holder.address, lp: lpHolders[i].pct})

					if (txn.instructions.length > 18) {
						executionQueue.push(txn)

						//Reset txn for next round
						txn = new anchor.web3.Transaction()
					}
				}


			} else {
				//Normal account - process as normal
				const totalAmount = Math.floor(holder.amount * amountPerToken);

				txn.add(SystemProgram.transfer({
					fromPubkey: owner.publicKey,
					toPubkey: new anchor.web3.PublicKey(holder.owner),
					lamports: totalAmount,
				}))
				list.push({address: holder.owner, amount: totalAmount})

				if (txn.instructions.length > 18) {
					executionQueue.push(txn)

					//Reset txn for next round
					txn = new anchor.web3.Transaction()
				}
			}
		}

		executionQueue.push(txn)

		return list
	}


	/**
	 * Process batch sending of Token2022 via Lookup Tables
	 * @param startIndex
	 * @param endIndex
	 * @param currentHolders
	 * @param amountPerToken
	 * @param src
	 * @param tokenMint
	 * @param owner
	 * @param mintInfo
	 * @param mintProgram
	 */
	async function processBatch(startIndex, endIndex, currentHolders, amountPerToken, src, tokenMint, owner, mintInfo, mintProgram) {
		const ixs = [];

		const [createIx, lut] = await createAddressTableInstruction()
		ixs.push(createIx)

		const addrs = []
		for (let i = startIndex; i < endIndex; i++) {
			const holder = currentHolders[i];
			if (holder.amount <= 0)
				continue

			const holderAddr = new anchor.web3.PublicKey(holder.address)
			addrs.push(holderAddr)
			const totalAmount = Math.floor(holder.amount * amountPerToken);
			ixs.push(createTransferCheckedInstruction(src, tokenMint, holderAddr, owner.publicKey, totalAmount, mintInfo.decimals, [], mintProgram));
		}

		const extendIx = await extendAddressTableInstruction(lut, addrs)
		ixs.push(extendIx)

		//Get our newly created LUT
		// let lookupTableAccount = await connection
		// 	.getAddressLookupTable(lut)
		// 	.then((res) => res.value);

		//Create our LUT for the accounts
		const lookupTableAccount = new AddressLookupTableAccount({
			key: lut,
			state: {
				deactivationSlot: BigInt(0),
				lastExtendedSlot: 0,
				lastExtendedSlotStartIndex: 0,
				authority: owner.publicKey,
				addresses: addrs
			}
		})

		//Close the table once we are done
		ixs.push(AddressLookupTableProgram.closeLookupTable({
			authority: owner.publicKey,
			lookupTable: lut,
			recipient: owner.publicKey
		}))

		const latestBlockHash = await connection.getLatestBlockhash();
		const msg = new anchor.web3.TransactionMessage({
			payerKey: owner.publicKey,
			recentBlockhash: latestBlockHash.blockhash,
			instructions: ixs
		}).compileToV0Message([lookupTableAccount])

		let txn = new anchor.web3.VersionedTransaction(msg);
		txn.sign([owner])

		const sig = await connection.sendTransaction(txn, {
			skipPreflight: skipPreflight,
			preflightCommitment: "confirmed"
		})

		await connection.confirmTransaction({
			signature: sig,
			blockhash: txn.message.recentBlockhash,
			lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
		})
		console.log("XFER Sig: ", sig);
	}

	/**
	 * Reflect tokens back to user based on their owned token amount
	 * @param reflectionTotalAmount
	 */
	async function reflectToHolders(reflectionTotalAmount) {
		console.log(`BUILD: reflect to holders ${reflectionTotalAmount}`)
		const src = getAssociatedTokenAddressSync(tokenMint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);
		const batchSize = 256; // size of each batch


		//Swap tokens to our reflection SPLv1 Token
		const reflectionAmount = await swapFluxbeamPool(
			tokenInput, //Input token
			reflectionInput, //Output token
			reflectionTotalAmount
		)

		if (!reflectionAmount) {
			console.error(`Unable to swap on fluxbeam ${tokenMint} -> ${reflectionMint}`)
			return
		}

		const reflectionPerToken = reflectionAmount / mintInfo.supply
		console.log(`Received ${reflectionAmount} of ${reflectionMint} - Per Token: ${reflectionPerToken}`)


		const list = [];
		for (let i = 0; i < currentHolders.length; i += batchSize) {
			const endIndex = Math.min(i + batchSize, currentHolders.length);

			if (reflectionMint.equals(WSOL)) {
				let l2 = await processBatchSOL(i, endIndex, currentHolders, reflectionPerToken)
				list.push(...l2);
			} else
				await processBatch(i, endIndex, currentHolders, reflectionPerToken, src, tokenMint, owner, mintInfo, mintProgram);
		}


		console.log("processBatchSOL", list.length)
		let data = JSON.stringify(list, null, 2);
		fs.writeFileSync('holderAllocation.json', data);
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


	async function buildLPProviderMaps() {
		//So you have your pools
		const pools = await getSwapPools(tokenMint)

		//Our LP map needs to hold the token accounts of the pools (Ft1u)
		for (let i = 0; i < pools.length; i++) {
			const pool = pools[i]
			lpAccountToPoolMap[pool.account.tokenAccountB.toString()] = pool.pubkey.toString()
			lpAccountToPoolMap[pool.account.tokenAccountA.toString()] = pool.pubkey.toString()


			//Get our holders from the pool
			const lp = []
			lpProviderMap[pool.pubkey.toString()] = []
			const resp = await connection.getTokenLargestAccounts(pool.account.tokenPool, "confirmed")
			const holders = resp.value.filter(h => h.uiAmount > 0)
			let totalLpTokens = 0

			//Loop through holders & get the address, tally up total LP across holders
			for (let i = 0; i < holders.length; i++) {
				lp.push(holders[i].address)
				totalLpTokens += holders[i].uiAmount
			}


			//Get the account info of these accounts to reveal their true owner
			const lpOwners = await connection.getMultipleParsedAccounts(lp, {commitment: "confirmed"})
			//@ts-ignore
			for (let i = 0; i < lpOwners.value.length; i++) {
				const h = lpOwners.value[i]

				lpProviderMap[pool.pubkey.toString()].push({
					//@ts-ignore
					address: h.data.parsed.info.owner,
					amount: holders[i].amount,
					uiAmount: holders[i].uiAmount,
					pct: holders[i].uiAmount / totalLpTokens
				})
			}
		}
	}

	/**
	 * Swaps via fluxbeam for a minOutAmount
	 * @param tokenA
	 * @param tokenB
	 * @param tokenAAmount
	 * @param minAmountOut
	 */
	async function swapFluxbeamPool(tokenA: TokenInput, tokenB: TokenInput, tokenAAmount, minAmountOut = 0) {
		console.log(`Getting swap pool - ${tokenA.mint} -> ${tokenB.mint}`)
		const pools = await swapClient.getSwapPools(tokenA.mint, tokenB.mint)
		// console.log('(swapFluxbeamPool) pools found are\t', pools);

		// const route = pools.find(pool => pool.pubkey === new anchor.web3.PublicKey('Ebbpz3PWLaQxj2oyK967RgEPbcPypjQCoZ3tpB4fwLsk'));
		// if (!route) {
		// 	throw new Error("No pools for swap input")
		// }
		const route = pools[0]

		const dstAta = getAssociatedTokenAddressSync(tokenB.mint, owner.publicKey, false, tokenB.programID)
		const srcAta = getAssociatedTokenAddressSync(tokenA.mint, owner.publicKey, false, tokenB.programID)
		let preBalance
		if (tokenB.mint.equals(WSOL)) {
			preBalance = await connection.getBalance(owner.publicKey, "confirmed").catch(e => {
				console.error(`Failed getting balance for ${dstAta} - Mint: ${tokenB.mint}`)
			})
		} else {
			preBalance = await connection.getTokenAccountBalance(dstAta, "confirmed").catch(e => {
				console.error(`Failed getting balance for ${dstAta} - Mint: ${tokenB.mint}`)
			})
		}
		console.log("Pre Balance", preBalance)

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

		//We need to do this here so we get correct balance
		const sig = await sendAndConfirmTransaction(connection, txn, [owner], {skipPreflight: skipPreflight});

		console.log("Swap Sig: ", sig)

		let postBalance
		if (tokenB.mint.equals(WSOL)) {
			postBalance = await connection.getBalance(owner.publicKey, "confirmed").catch(e => {
				console.error(`Failed getting balance for ${dstAta} - Mint: ${tokenB.mint}`)
			})
		} else {
			postBalance = await connection.getTokenAccountBalance(dstAta, "confirmed").catch(e => {
				console.error(`Failed getting balance for ${dstAta} - Mint: ${tokenB.mint}`)
			})
		}
		// console.debug("postBalance", postBalance?.value.amount, Number(postBalance?.value.amount) - Number(preBalance?.value.amount))
		console.log("Post Balance", postBalance)

		return Number(postBalance?.value?.amount || postBalance) - Number(preBalance?.value?.amount || preBalance) + 5000
	}

	//Create a new LUT
	async function createAddressTableInstruction(recentSlot = 0) {
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

	//Gets the swap pools for liquidity providers
	async function getSwapPools(mint) {
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

	//Load wallet from keypair
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


	//Converts array into chunked array
	function chunkArray(myArray, chunk_size) {
		let results = [];

		while (myArray.length) {
			results.push(myArray.splice(0, chunk_size));
		}

		return results;
	}
})