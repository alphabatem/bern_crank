import {
	createAssociatedTokenAccountInstruction,
	createInitializeMint2Instruction,
	createSyncNativeInstruction,
	createTransferCheckedInstruction,
	getAssociatedTokenAddressSync,
	getMinimumBalanceForRentExemptMint,
	MINT_SIZE,
	TOKEN_2022_PROGRAM_ID
} from "@solana/spl-token";
import {BN, web3} from "@project-serum/anchor";
import {Connection, SystemProgram} from "@solana/web3.js";
import {blob, struct, u64, u8} from "../marshmallow";
import {Numberu64, PoolConfig, TokenInput, TokenSwapLayout} from "./layouts";
import {SWAP_PROGRAM_ID, WSOL} from "./constants";




export const SWAP_PROGRAM_OWNER_FEE_ADDRESS = new web3.PublicKey("beamazjPnFT3JQoe16HjUxkpmHFfsHY6dTqf3VwBXzq");
export const TRADING_FEE_NUMERATOR = 20;
export const TRADING_FEE_DENOMINATOR = 100;
export const OWNER_TRADING_FEE_NUMERATOR = 5;
export const OWNER_TRADING_FEE_DENOMINATOR = 100;
export const OWNER_WITHDRAW_FEE_NUMERATOR = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 0 : 1;
export const OWNER_WITHDRAW_FEE_DENOMINATOR = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 0 : 100;
export const HOST_FEE_NUMERATOR = 20;
export const HOST_FEE_DENOMINATOR = 100;

export class CreateTokenPool {

	poolTokenProgramId = TOKEN_2022_PROGRAM_ID //The program ID of the token program for the pool tokens

	connection;
	config;
	payer;
	owner;

	tokenA;
	tokenB;

	tokenSwapAccount = web3.Keypair.generate()
	tokenPoolMint = web3.Keypair.generate()

	tokenAccountPool;
	feeAccountAta;

	//Filled when init called
	tokenAccountA: web3.PublicKey = web3.PublicKey.default
	tokenAccountB: web3.PublicKey = web3.PublicKey.default


	authority: web3.PublicKey


	constructor(connection: web3.Connection, payer: web3.PublicKey, owner: web3.PublicKey, tokenA: TokenInput, tokenB: TokenInput, config: PoolConfig) {
		this.connection = connection
		this.payer = payer
		this.owner = owner
		this.config = config

		this.tokenA = tokenA
		this.tokenB = tokenB


		//Create ATAs
		const [authority] = web3.PublicKey.findProgramAddressSync([this.tokenSwapAccount.publicKey.toBuffer()], SWAP_PROGRAM_ID);
		this.authority = authority

		this.tokenAccountPool = getAssociatedTokenAddressSync(this.tokenPoolMint.publicKey, this.owner, true, TOKEN_2022_PROGRAM_ID)

		const ownerKey = SWAP_PROGRAM_OWNER_FEE_ADDRESS || owner;
		this.feeAccountAta = getAssociatedTokenAddressSync(this.tokenPoolMint.publicKey, ownerKey, false, TOKEN_2022_PROGRAM_ID)
	}

	async initializeTransaction() {
		const {transaction, signers} = await this.initializeTransactionInstruction()

		const bhash = await this.connection.getLatestBlockhash("confirmed")
		transaction.recentBlockhash = bhash.blockhash
		transaction.feePayer = this.payer
		return {transaction, signers}
	}

	async createTransaction() {
		const {transaction, signers} = await this.createTransactionInstruction()

		const bhash = await this.connection.getLatestBlockhash("confirmed")
		transaction.recentBlockhash = bhash.blockhash
		transaction.feePayer = this.payer
		return {transaction, signers}
	}

	async initializeTransactionInstruction() {
		const transaction = new web3.Transaction();
		const signers = [
			this.tokenPoolMint,
		];

		//Create the pool mint
		transaction.add(
			SystemProgram.createAccount({
				fromPubkey: this.payer,
				newAccountPubkey: this.tokenPoolMint.publicKey,
				space: MINT_SIZE,
				lamports: await getMinimumBalanceForRentExemptMint(this.connection),
				programId: TOKEN_2022_PROGRAM_ID,
			}),
			createInitializeMint2Instruction(this.tokenPoolMint.publicKey, 2, this.authority, null, TOKEN_2022_PROGRAM_ID)
		)


		//Create pool account
		transaction.add(
			createAssociatedTokenAccountInstruction(
				this.payer,
				this.tokenAccountPool,
				this.owner,
				this.tokenPoolMint.publicKey,
				TOKEN_2022_PROGRAM_ID
			)
		)

		//Create fee account
		const ownerKey = SWAP_PROGRAM_OWNER_FEE_ADDRESS || this.owner;
		transaction.add(
			createAssociatedTokenAccountInstruction(
				this.payer,
				this.feeAccountAta,
				ownerKey,
				this.tokenPoolMint.publicKey,
				TOKEN_2022_PROGRAM_ID
			),
		);


		//Are the tokens native sol?
		const tokenANative = this.tokenA.mint.equals(WSOL);
		const tokenBNative = this.tokenB.mint.equals(WSOL);


		//Create pool ATAs
		this.tokenAccountA = getAssociatedTokenAddressSync(this.tokenA.mint, this.authority, true, this.tokenA.programID)
		this.tokenAccountB = getAssociatedTokenAddressSync(this.tokenB.mint, this.authority, true, this.tokenB.programID)


		if (tokenANative) {
			transaction.add(
				createAssociatedTokenAccountInstruction(this.payer, this.tokenAccountA, this.authority, this.tokenA.mint, this.tokenA.programID),
				createSyncNativeInstruction(this.tokenAccountA))
		} else {
			transaction.add(
				createAssociatedTokenAccountInstruction(this.payer, this.tokenAccountA, this.authority, this.tokenA.mint, this.tokenA.programID),
			)
		}

		if (tokenBNative) {
			transaction.add(
				createAssociatedTokenAccountInstruction(this.payer, this.tokenAccountB, this.authority, this.tokenB.mint, this.tokenB.programID),
				createSyncNativeInstruction(this.tokenAccountB))
		} else {
			transaction.add(
				createAssociatedTokenAccountInstruction(this.payer, this.tokenAccountB, this.authority, this.tokenB.mint, this.tokenB.programID),
			)
		}


		return {
			transaction: transaction,
			signers
		}
	}

	async createTransactionInstruction() {
		const transaction = new web3.Transaction()

		// Create the pool
		const balanceNeeded = await this.getMinBalanceRentForExemptTokenSwap(this.connection);
		transaction.add(
			web3.SystemProgram.createAccount({
				fromPubkey: this.payer,
				newAccountPubkey: this.tokenSwapAccount.publicKey,
				lamports: balanceNeeded,
				space: TokenSwapLayout.span,
				programId: SWAP_PROGRAM_ID,
			}),
		);

		//Transfer initial liquidity
		const payerAtaA = getAssociatedTokenAddressSync(this.tokenA.mint, this.payer, false, this.tokenA.programID)
		const payerAtaB = getAssociatedTokenAddressSync(this.tokenB.mint, this.payer, false, this.tokenB.programID)

		const mintAInfo = await this.tokenA.getMintInfo(this.connection)
		const mintBInfo = await this.tokenB.getMintInfo(this.connection)


		if (this.tokenA.mint.equals(WSOL)) {
			transaction.add(
				web3.SystemProgram.transfer({
					fromPubkey: this.payer,
					toPubkey: this.tokenAccountA,
					lamports: this.tokenA.amount,
				}),
				createSyncNativeInstruction(this.tokenAccountA),
			)
		} else {
			transaction.add(createTransferCheckedInstruction(payerAtaA, this.tokenA.mint, this.tokenAccountA, this.payer, this.tokenA.amount, mintAInfo.value.decimals, [], this.tokenA.programID))
		}

		if (this.tokenB.mint.equals(WSOL)) {
			transaction.add(
				web3.SystemProgram.transfer({
					fromPubkey: this.payer,
					toPubkey: this.tokenAccountB,
					lamports: this.tokenB.amount,
				}),
				createSyncNativeInstruction(this.tokenAccountB),
			)
		} else {
			transaction.add(createTransferCheckedInstruction(payerAtaB, this.tokenB.mint, this.tokenAccountB, this.payer, this.tokenB.amount, mintBInfo.value.decimals, [], this.tokenB.programID))
		}

		transaction.add(
			this.createInitSwapInstruction(
				this.tokenSwapAccount,
				this.authority,
				this.tokenAccountA,
				this.tokenAccountB,
				this.tokenPoolMint.publicKey,
				this.feeAccountAta,
				this.tokenAccountPool,
				this.poolTokenProgramId,
				SWAP_PROGRAM_ID,
				this.config.tradeFee.numerator || TRADING_FEE_NUMERATOR,
				this.config.tradeFee.denominator || TRADING_FEE_DENOMINATOR,
				this.config.ownerTradeFee.numerator || OWNER_TRADING_FEE_NUMERATOR,
				this.config.ownerTradeFee.denominator || OWNER_TRADING_FEE_DENOMINATOR,
				this.config.ownerWithdrawFee.numerator || OWNER_WITHDRAW_FEE_NUMERATOR,
				this.config.ownerWithdrawFee.denominator || OWNER_WITHDRAW_FEE_DENOMINATOR,
				this.config.hostFee.numerator || HOST_FEE_NUMERATOR,
				this.config.hostFee.denominator || HOST_FEE_DENOMINATOR,
				this.config.curveType,
			),
		)

		return {
			transaction: transaction,
			signers: [
				this.tokenSwapAccount,
			]
		}
	}

	async getMinBalanceRentForExemptTokenSwap(
		connection: Connection,
	): Promise<number> {
		return await connection.getMinimumBalanceForRentExemption(
			TokenSwapLayout.span,
		);
	}


	createInitSwapInstruction(
		tokenSwapAccount: web3.Keypair,
		authority: web3.PublicKey,
		tokenAccountA: web3.PublicKey,
		tokenAccountB: web3.PublicKey,
		tokenPool: web3.PublicKey,
		feeAccount: web3.PublicKey,
		tokenAccountPool: web3.PublicKey,
		poolTokenProgramId: web3.PublicKey,
		swapProgramId: web3.PublicKey,
		tradeFeeNumerator: number,
		tradeFeeDenominator: number,
		ownerTradeFeeNumerator: number,
		ownerTradeFeeDenominator: number,
		ownerWithdrawFeeNumerator: number,
		ownerWithdrawFeeDenominator: number,
		hostFeeNumerator: number,
		hostFeeDenominator: number,
		curveType: number,
		curveParameters: Numberu64 = new Numberu64(0),
	): web3.TransactionInstruction {
		const keys = [
			{pubkey: tokenSwapAccount.publicKey, isSigner: false, isWritable: true},
			{pubkey: authority, isSigner: false, isWritable: false},
			{pubkey: tokenAccountA, isSigner: false, isWritable: false},
			{pubkey: tokenAccountB, isSigner: false, isWritable: false},
			{pubkey: tokenPool, isSigner: false, isWritable: true},
			{pubkey: feeAccount, isSigner: false, isWritable: false},
			{pubkey: tokenAccountPool, isSigner: false, isWritable: true},
			{pubkey: poolTokenProgramId, isSigner: false, isWritable: false},
		];

		const commandDataLayout = struct([
			u8('instruction'),
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
		])

		let data = Buffer.alloc(1024);

		// package curve parameters
		// NOTE: currently assume all curves take a single parameter, u64 int
		//       the remaining 24 of the 32 bytes available are filled with 0s
		const curveParamsBuffer = Buffer.alloc(32);
		curveParameters.toBuffer().copy(curveParamsBuffer);

		{
			const encodeLength = commandDataLayout.encode(
				{
					instruction: 0, // InitializeSwap instruction
					tradeFeeNumerator: new BN(tradeFeeNumerator),
					tradeFeeDenominator: new BN(tradeFeeDenominator),
					ownerTradeFeeNumerator: new BN(ownerTradeFeeNumerator),
					ownerTradeFeeDenominator: new BN(ownerTradeFeeDenominator),
					ownerWithdrawFeeNumerator: new BN(ownerWithdrawFeeNumerator),
					ownerWithdrawFeeDenominator: new BN(ownerWithdrawFeeDenominator),
					hostFeeNumerator: new BN(hostFeeNumerator),
					hostFeeDenominator: new BN(hostFeeDenominator),
					curveType,
					curveParameters: curveParamsBuffer,
				},
				data,
			);
			data = data.slice(0, encodeLength);
		}
		return new web3.TransactionInstruction({
			keys,
			programId: swapProgramId,
			data,
		});
	}
}
