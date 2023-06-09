import * as anchor from "@project-serum/anchor";
import {web3} from "@project-serum/anchor";
import {buildLPProviderMaps} from "../market_maker/lp_holders";
import {Queue} from "../market_maker/queue";
import {SystemProgram} from "@solana/web3.js";
import {WSOL} from "../token_swap/constants";
import {TOKEN_2022_PROGRAM_ID} from "@solana/spl-token";
import {transferTokenAmountInstruction} from "../market_maker/instructions";

export class Airdrop {

	queue = new Queue();

	mint: web3.PublicKey

	isSOLTransfer: boolean;

	connection: web3.Connection

	poolMap = {}
	poolHolderMap = {}

	airdropList = []


	//Token mint info
	mintInfo;

	constructor(connection: web3.Connection, mint: web3.PublicKey) {
		this.connection = connection
		this.mint = mint
		this.isSOLTransfer = this.mint.equals(WSOL)

		this.getMintInfo()
		this.configure()
	}

	async configure() {
		const {lpAccountToPoolMap, lpProviderMap} = await buildLPProviderMaps(this.connection, this.mint)
		this.poolMap = lpAccountToPoolMap
		this.poolHolderMap = lpProviderMap
	}

	setAirdropList(holders = []) {
		this.airdropList = holders
	}


	async getMintInfo() {
		this.mintInfo = await this.connection.getParsedAccountInfo(this.mint, "confirmed")
		this.mintInfo = this.mintInfo?.value.data.parsed.info
	}

	/**
	 * Starts the airdrop procedure
	 * @param owner
	 * @param reflectionPerToken
	 * @param programID
	 */
	async start(owner: web3.Keypair, reflectionPerToken: number, programID = TOKEN_2022_PROGRAM_ID) {
		await this.processBatch(owner.publicKey, 0, this.airdropList.length, reflectionPerToken, programID);
		return this.queue.process(this.connection, owner)
	}

	/**
	 * Validate if a holder should be sent to or not, checks for LP accounts
	 * - If LP account detected, underlying providers allocated divided amount
	 * @param holder
	 */
	validateHolder(holder): boolean {
		if (!this.poolMap[holder.address]) {
			return true
		}

		const lpHolders = this.poolHolderMap[this.poolMap[holder.address]]
		for (let i = 0; i < lpHolders.length; i++) {
			this.airdropList.push({
				amount: holder.amount * lpHolders[i].pct,
				owner: lpHolders[i].address
			})
		}

		return false
	}


	async processBatch(owner: web3.PublicKey, startIndex, endIndex, amountPerToken, programID = TOKEN_2022_PROGRAM_ID) {
		let txn = new anchor.web3.Transaction()

		for (let i = startIndex; i < endIndex; i++) {
			const holder = this.airdropList[i];
			if (holder.amount <= 0 || !this.validateHolder(holder))
				continue


			//Normal account - process as normal
			const totalAmount = Math.floor(holder.amount * amountPerToken);

			if (this.isSOLTransfer) {
				txn.add(SystemProgram.transfer({
					fromPubkey: owner,
					toPubkey: new anchor.web3.PublicKey(holder.owner),
					lamports: totalAmount,
				}))
			} else {
				const {ix} = transferTokenAmountInstruction(owner, holder.owner, this.mint, totalAmount, this.mintInfo.decimals, programID)
				txn.add(ix)
			}


			if (txn.instructions.length > 18) {
				this.queue.push(txn)
				//Reset txn for next round
				txn = new anchor.web3.Transaction()
			}

		}
	}
}