import {createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID} from "@solana/spl-token";
import * as anchor from "@project-serum/anchor";
import {web3} from "@project-serum/anchor";
import {Connection} from "@solana/web3.js";
import {getAllTokenHolders, getTokenBalance, loadWalletKey} from "./market_maker/util";
import {burnTokenAmountInstruction, transferTokenAmountInstruction} from "./market_maker/instructions";
import {Airdrop} from "./airdrop/airdrop";


describe("Holder Reflection", () => {
	//Enter RPC URL
	const connection = new Connection("https://rpc.hellomoon.io/f197c876-52d7-4566-bc4c-af4405029777", "confirmed")

	const owner = loadWalletKey("./MmntXw42jkjfFQ9ju5vpucRL29Sos2ENmmSRk9cRwyG.json")

	//Token mint
	let tokenMint = new anchor.web3.PublicKey("EJnCTVdGkYocPpei7rjTcuiWPkretrku8N1wvuvfL99F");

	//Set to burn BONK
	let tokenBurnMint = new anchor.web3.PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");

	//DAO Address (.1%)
	const daoAddress = new anchor.web3.PublicKey("DBR2ZUvjZTcgy6R9US64t96pBEZMyr9DPW6G2scrctQK")

	//Dev Address (.3%)
	const devAddress = new anchor.web3.PublicKey("AZRMSXfBrGwpWHLC2ZPnbs4YdGD5ezvS1eAyDyRWt1E2")

	//Owner authority token account
	const ata = getAssociatedTokenAddressSync(tokenMint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID)
	console.log("ATA:", ata.toString())

	const airdrop = new Airdrop(connection, tokenMint)

	//Token mint info
	let mintInfo;

	let currentHolders = [];

	it('Reflect tokens', async () => {
		//Token mint info
		mintInfo = (await connection.getParsedAccountInfo(tokenMint, "confirmed"))
		mintInfo = mintInfo.value.data.parsed.info


		// currentHolders = await getTokenAccountsByMint(tokenMint);
		currentHolders = await getAllTokenHolders(tokenMint);
		console.log("Current Holders", currentHolders.length)

		const config = {
			feePct: 6.9,
			mint: new web3.PublicKey("CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo"),
		}

		const currentTokenBalance = await getTokenBalance(connection, ata)
		console.log("Token Balance", currentTokenBalance)
		if (currentTokenBalance <= 0) {
			console.log("No tokens to distribute: ", currentTokenBalance)
			return
		}

		//Calculate percentages based on our {feePct}% split
		const daoPct = 0.1 / config.feePct
		const devPct = 0.3 / config.feePct
		const burnPct = 1.5 / config.feePct
		const reflectPct = 5 / config.feePct


		//Send 0.4% to Dao & Dev wallet (0.1/0.3)
		const daoAmount = Math.floor(currentTokenBalance * daoPct)
		const devAmount = Math.floor(currentTokenBalance * devPct)
		console.log(`ALLOCATE <-  DAO: ${daoAmount} (${daoPct}%) - DEV: ${devAmount} (${devPct}%)`)
		await buildDevDaoAllocationTransaction(daoAmount, devAmount)


		//Burn any BONK tokens in the wallet
		const bonkBalance = await getTokenBalance(connection, getAssociatedTokenAddressSync(tokenBurnMint, owner.publicKey, false))
		if (bonkBalance > 0) {
			console.log(`BURN <-     ${bonkBalance}`)
			await burnTokens(bonkBalance)
		}

		//Send 5% to buy SOL to REFLECT
		const reflectAmount = currentTokenBalance * reflectPct
		console.log(`REFLECT <-  ${reflectAmount} (${reflectPct}%)`)
		await reflectToHolders(owner, reflectAmount, currentHolders)
	})


	/**
	 * Builds the transfer transaction for allocation to dev & dao wallets
	 *
	 * @param daoAmount
	 * @param devAmount
	 */
	async function buildDevDaoAllocationTransaction(daoAmount, devAmount) {
		console.log(`BUILD: Send Dev & Dao Allocation`)

		let txn = new anchor.web3.Transaction()

		//Send 0.1% to BONK DAO
		const {ix: daoIx, dstAta: daoAta} = await transferTokenAmountInstruction(owner.publicKey, daoAddress, tokenMint, daoAmount, mintInfo.decimals, TOKEN_2022_PROGRAM_ID)
		const daoAtaInfo = await connection.getParsedAccountInfo(daoAta, "confirmed")
		if (!daoAtaInfo.value)
			txn.add(createAssociatedTokenAccountInstruction(owner.publicKey, daoAta, daoAddress, tokenMint, TOKEN_2022_PROGRAM_ID))

		//Send 0.3% to Dev Wallet
		const {ix: devIx, dstAta: devAta} = await transferTokenAmountInstruction(owner.publicKey, devAddress, tokenMint, devAmount, mintInfo.decimals, TOKEN_2022_PROGRAM_ID)
		const devAtaInfo = await connection.getParsedAccountInfo(devAta, "confirmed")
		if (!devAtaInfo.value)
			txn.add(createAssociatedTokenAccountInstruction(owner.publicKey, devAta, devAddress, tokenMint, TOKEN_2022_PROGRAM_ID))

		//Add our transfer commands
		txn.add(daoIx)
		txn.add(devIx)

		return txn
	}


	/**
	 * Burns a given amount of tokenBurnMint tokens
	 *
	 * @param burnAmount
	 */
	async function burnTokens(burnAmount: number) {
		console.log(`BUILD: Burning ${burnAmount} Tokens`)
		const txn = new anchor.web3.Transaction()

		//Burn the Burn tokens
		txn.add(await burnTokenAmountInstruction(owner.publicKey, tokenBurnMint, burnAmount, mintInfo.decimals, TOKEN_PROGRAM_ID))

		return txn
	}


	/**
	 * Reflect tokens back to user based on their owned token amount
	 * @param owner
	 * @param reflectionTotalAmount
	 * @param holders
	 */
	async function reflectToHolders(owner: web3.Keypair, reflectionTotalAmount, holders = []) {
		console.log(`BUILD: reflect to holders ${reflectionTotalAmount}`)

		const reflectionPerToken = reflectionTotalAmount / mintInfo.supply
		console.log(`Using Source Token ${reflectionTotalAmount} - Per Token: ${reflectionPerToken}`)


		//Configure our list
		airdrop.setAirdropList(holders)
		return airdrop.start(owner, reflectionPerToken)
	}
})
