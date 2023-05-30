import {BN, web3} from "@project-serum/anchor";
import {
	createAssociatedTokenAccountInstruction,
	createCloseAccountInstruction,
	createSyncNativeInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_2022_PROGRAM_ID
} from "@solana/spl-token";
import {PoolConfig, TokenInput, TokenSwapLayout, TokenSwapPool} from "./layouts";
import {SWAP_PROGRAM_ID, WSOL} from "./constants";
import {CreateTokenPool} from "./create_token_pool";
import Instructions from "./instructions";

export default class Client {

	connection;

	poolTokenProgramId = TOKEN_2022_PROGRAM_ID //The program ID of the token program for the pool tokens

	constructor(connection: web3.Connection) {
		this.connection = connection
	}


	async getPools() {
		const resp = await this.connection.getProgramAccounts(SWAP_PROGRAM_ID)
		return resp.map((m) => {
			return {pubkey: m.pubkey, account: TokenSwapLayout.decode(m.account.data)}
		})
	}


	async getSwapPools(tokenA: web3.PublicKey, tokenB: web3.PublicKey) {
		const resp = await this.connection.getProgramAccounts(SWAP_PROGRAM_ID, {
			commitment: 'confirmed',
			filters: [
				{
					memcmp: {
						offset: 1 + 1 + 1 + 32 + 32 + 32 + 32,
						bytes: tokenA.toString(),
					},
				},
				{
					memcmp: {
						offset: 1 + 1 + 1 + 32 + 32 + 32 + 32 + 32,
						bytes: tokenB.toString(),
					},
				},
			],
		})
		const respInverse = await this.connection.getProgramAccounts(SWAP_PROGRAM_ID, {
			commitment: 'confirmed',
			filters: [
				{
					memcmp: {
						offset: 1 + 1 + 1 + 32 + 32 + 32 + 32,
						bytes: tokenB.toString(),
					},
				},
				{
					memcmp: {
						offset: 1 + 1 + 1 + 32 + 32 + 32 + 32 + 32,
						bytes: tokenA.toString(),
					},
				},
			],
		})
		return resp.concat(respInverse).map((m) => {
			return {pubkey: m.pubkey, account: TokenSwapLayout.decode(m.account.data)}
		})
	}


	async getPool(pool: web3.PublicKey) {
		const resp = await this.connection.getAccountInfo(pool)
		return {pubkey: pool, owner: resp?.owner, account: TokenSwapLayout.decode(resp!.data)}
	}

	async getPoolDetail(poolPK: web3.PublicKey, pool: TokenSwapPool, walletPk: web3.PublicKey) {
		const [authority] = web3.PublicKey.findProgramAddressSync([poolPK.toBuffer()], SWAP_PROGRAM_ID);
		const resp = await this.connection.getMultipleParsedAccounts([
			pool.tokenAccountA,
			pool.tokenAccountB,
			getAssociatedTokenAddressSync(pool.tokenPool, poolPK, false, TOKEN_2022_PROGRAM_ID),
			getAssociatedTokenAddressSync(pool.tokenPool, walletPk, false, TOKEN_2022_PROGRAM_ID),
			pool.mintA,
			pool.mintB,
		])

		return {
			//@ts-ignore
			tokenAccountA: resp?.value[0]?.data?.parsed?.info,
			//@ts-ignore
			tokenAccountB: resp?.value[1]?.data?.parsed?.info,
			//@ts-ignore
			tokenPool: resp?.value[2]?.data?.parsed?.info,
			//@ts-ignore
			userLP: resp?.value[3]?.data?.parsed?.info,
			//@ts-ignore
			mintA: resp?.value[4]?.data?.parsed?.info,
			//@ts-ignore
			mintB: resp?.value[5]?.data?.parsed?.info,
			poolAddress: poolPK,
		}
	}

	async createPoolTransactions(
		payer: web3.PublicKey,
		feeAccount: web3.PublicKey,
		tokenA: TokenInput,
		tokenB: TokenInput,
		config: PoolConfig,
	) {
		const cp = new CreateTokenPool(
			this.connection,
			payer,
			feeAccount,
			tokenA,
			tokenB,
			config
		)

		const initTxn = await cp.initializeTransaction()
		const createTxn = await cp.createTransaction()

		// return [
		// 	{
		// 		txn: initTxn.transaction,
		// 		signers: initTxn.signers
		// 	}, {
		// 		txn: createTxn.transaction,
		// 		signers: createTxn.signers
		// 	}
		// ]

		initTxn.transaction.add(...createTxn.transaction.instructions)
		initTxn.signers.push(...createTxn.signers)

		return [
			{
				pool: cp.tokenSwapAccount.publicKey,
				txn: initTxn.transaction,
				signers: initTxn.signers
			}
		]
	}

	async createSwapTransaction(payer: web3.PublicKey, pool: web3.PublicKey, srcMint: TokenInput, dstMint: TokenInput, route: TokenSwapPool, amountIn: number, minimumAmountOut: number) {
		const aToB = srcMint.mint.equals(route.mintA)

		console.log("createSwapTransaction", {
			amountIn,
			minimumAmountOut,
			srcMint: srcMint.mint.toString(),
			dstMint: dstMint.mint.toString(),
			routeSrc: route.mintA.toString(),
			routeDst: route.mintB.toString(),
			aToBo: aToB
		})
		const mintAInfo = await this.connection.getParsedAccountInfo(srcMint.mint)
		const mintBInfo = await this.connection.getParsedAccountInfo(dstMint.mint)

		const transaction = new web3.Transaction()

		const [authority] = web3.PublicKey.findProgramAddressSync([pool.toBuffer()], SWAP_PROGRAM_ID);

		const userSource = getAssociatedTokenAddressSync(srcMint.mint, payer, false, mintAInfo.value?.owner!)
		const userDestination = getAssociatedTokenAddressSync(dstMint.mint, payer, false, mintBInfo.value?.owner!)

		const poolSource = aToB ? route.tokenAccountA : route.tokenAccountB
		const poolDestination = aToB ? route.tokenAccountB : route.tokenAccountA


		if (srcMint.mint.equals(WSOL)) {
			//Do sync native checks
			const ixs = await this.getWrapSOLInstructions(payer, srcMint.amount);
			if (ixs.length > 0)
				transaction.add(...ixs)
		}

		transaction.add(Instructions.createSwapInstruction(
			pool,
			authority,
			payer,
			userSource,
			poolSource,
			poolDestination,
			userDestination,
			route.tokenPool,
			route.feeAccount,
			route.feeAccount, //hostFeeAccount,
			srcMint.mint,
			dstMint.mint,
			SWAP_PROGRAM_ID,
			mintAInfo.value?.owner!,
			mintBInfo.value?.owner!,
			TOKEN_2022_PROGRAM_ID,
			new BN(amountIn, 10),
			new BN(minimumAmountOut, 10),
		))

		if (dstMint.mint.equals(WSOL)) {
			//Do sync native checks
			transaction.add(this.getUnwrapSOLInstruction(payer))
		}

		return transaction
	}


	async createAddLiquidityTransaction(payer: web3.PublicKey, pool: web3.PublicKey, route: TokenSwapPool, srcMint: TokenInput, dstMint: TokenInput, poolTokenAmount: BN) {
		const mintAInfo = await this.connection.getParsedAccountInfo(route.mintA)
		const mintBInfo = await this.connection.getParsedAccountInfo(route.mintB)
		const [authority] = web3.PublicKey.findProgramAddressSync([pool.toBuffer()], SWAP_PROGRAM_ID);

		const userAccountA = getAssociatedTokenAddressSync(route.mintA, payer, false, mintAInfo.value?.owner!)
		const userAccountB = getAssociatedTokenAddressSync(route.mintB, payer, false, mintBInfo.value?.owner!)

		const userPoolTokenAccount = getAssociatedTokenAddressSync(route.tokenPool, payer, false, TOKEN_2022_PROGRAM_ID)

		console.log("Adding Liquidity", {
			pool,
			authority: authority.toString(),
			srcAmountIn: srcMint.amount,
			srcMint: srcMint.mint.toString(),
			dstAmountIn: dstMint.amount,
			dstMint: dstMint.mint.toString(),
			minOut: poolTokenAmount.toString(),
		})

		const balanceInfo = await this.connection.getMultipleParsedAccounts([userAccountA, userAccountB, route.tokenAccountA, route.tokenAccountB, userPoolTokenAccount])

		const [uAInfo, uBInfo, tAInfo, tBInfo, spInfo] = balanceInfo.value

		console.log({
			//@ts-ignore
			userAccountAAmount: uAInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			userAccountBAmount: uBInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			tokenAccountAAmount: tAInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			tokenAccountBAmount: tBInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			sourcePoolAccountAmount: spInfo?.data.parsed.info.tokenAmount.amount,
		})

		const transaction = new web3.Transaction()
		// deposit_all_token_types  deposit_single_token_type_exact_amount_in


		if (route.mintA.equals(WSOL)) {
			//Do sync native checks
			const ixs = await this.getWrapSOLInstructions(payer, srcMint.amount);
			if (ixs.length > 0)
				transaction.add(...ixs)
		}

		if (route.mintB.equals(WSOL)) {
			//Do sync native checks
			const ixs = await this.getWrapSOLInstructions(payer, dstMint.amount);
			if (ixs.length > 0)
				transaction.add(...ixs)
		}

		transaction.add(Instructions.depositAllTokenTypesInstruction(
			pool,
			authority,
			payer,
			userAccountA,
			userAccountB,
			route.tokenAccountA,
			route.tokenAccountB,
			route.tokenPool,
			userPoolTokenAccount,
			route.mintA,
			route.mintB,
			SWAP_PROGRAM_ID,
			mintAInfo.value?.owner!,
			mintBInfo.value?.owner!,
			TOKEN_2022_PROGRAM_ID,
			new BN(poolTokenAmount, 10),
			new BN(srcMint.amount, 10),
			new BN(dstMint.amount, 10),
		))

		if (route.mintB.equals(WSOL)) {
			//Do sync native checks
			transaction.add(await this.getUnwrapSOLInstruction(payer))
		}

		return transaction
	}

	async createRemoveLiquidityTransaction(payer: web3.PublicKey, pool: web3.PublicKey, route: TokenSwapPool, poolTokenAmount: number, minimumTokenA: number, minimumTokenB: number) {
		const mintAInfo = await this.connection.getParsedAccountInfo(route.mintA)
		const mintBInfo = await this.connection.getParsedAccountInfo(route.mintB)
		const [authority] = web3.PublicKey.findProgramAddressSync([pool.toBuffer()], SWAP_PROGRAM_ID);

		const userAccountA = getAssociatedTokenAddressSync(route.mintA, payer, false, mintAInfo.value?.owner!)
		const userAccountB = getAssociatedTokenAddressSync(route.mintB, payer, false, mintBInfo.value?.owner!)
		const userPoolTokenAccount = getAssociatedTokenAddressSync(route.tokenPool, payer, false, TOKEN_2022_PROGRAM_ID)
		// const userPoolTokenAccount = new web3.PublicKey("6ep1tmMLdKibZ2vGhYWaM97SqRSfGNMsWfdM1hENz3Lj")

		const balanceInfo = await this.connection.getMultipleParsedAccounts([userAccountA, userAccountB, route.tokenAccountA, route.tokenAccountB, userPoolTokenAccount])

		const [uAInfo, uBInfo, tAInfo, tBInfo, spInfo] = balanceInfo.value

		console.log({
			//@ts-ignore
			userAccountAAmount: uAInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			userAccountBAmount: uBInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			tokenAccountAAmount: tAInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			tokenAccountBAmount: tBInfo?.data.parsed.info.tokenAmount.amount,
			//@ts-ignore
			sourcePoolAccountAmount: spInfo?.data.parsed.info.tokenAmount.amount,
		})

		const transaction = new web3.Transaction()
		// deposit_all_token_types  deposit_single_token_type_exact_amount_in

		transaction.add(Instructions.withdrawAllTokenTypesInstruction(
			pool,
			authority,
			payer,
			route.tokenPool,
			route.feeAccount,
			userPoolTokenAccount,
			route.tokenAccountA,
			route.tokenAccountB,
			userAccountA,
			userAccountB,
			route.mintA,
			route.mintB,
			SWAP_PROGRAM_ID,
			TOKEN_2022_PROGRAM_ID,
			mintAInfo.value?.owner!,
			mintBInfo.value?.owner!,
			poolTokenAmount,
			minimumTokenA,
			minimumTokenB,
		))

		//Unwrap sol
		if (route.mintA.equals(WSOL) || route.mintB.equals(WSOL))
			transaction.add(this.getUnwrapSOLInstruction(payer))

		return transaction
	}


	async getWrapSOLInstructions(owner: web3.PublicKey, amount: number): Promise<web3.TransactionInstruction[]> {
		const ixs: web3.TransactionInstruction[] = []
		const ata = getAssociatedTokenAddressSync(WSOL, owner, false)
		const ataInfo = await this.connection.getTokenAccountBalance(ata).catch(() => {
		})

		if (ataInfo) {
			if (Number(ataInfo?.value.amount) >= amount)
				return ixs;
		}

		if (!ataInfo) {
			ixs.push(createAssociatedTokenAccountInstruction(owner, ata, owner, WSOL))
		}
		ixs.push(...[
			web3.SystemProgram.transfer({
				fromPubkey: owner,
				toPubkey: ata,
				lamports: amount - Number(ataInfo?.value.amount || 0),
			}),
			createSyncNativeInstruction(ata)
		])

		return ixs
	}

	getUnwrapSOLInstruction(owner: web3.PublicKey): web3.TransactionInstruction {
		const ata = getAssociatedTokenAddressSync(WSOL, owner, false)
		return createCloseAccountInstruction(ata, owner, owner)
	}
}