import * as anchor from "@project-serum/anchor";
import {web3} from "@project-serum/anchor";
import {
	createWithdrawWithheldTokensFromAccountsInstruction,
	createWithdrawWithheldTokensFromMintInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_2022_PROGRAM_ID
} from "@solana/spl-token";
import {sendAndConfirmTransaction} from "@solana/web3.js";
import {chunkArray} from "./util";


export async function reclaimWithheldFromAccounts(connection, mint: web3.PublicKey, owner: web3.Keypair, holders = [], opts = {}) {

	//Reclaim withheld from the mint to start
	await reclaimWithheldFromMint(connection, mint, owner, opts)

	const holderArr = holders.filter(h => h.amount > 0).map(h => new anchor.web3.PublicKey(h.address))

	const ata = getAssociatedTokenAddressSync(mint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID)

	// Split holderArr into batches
	const holderArrChunks = chunkArray(holderArr, 20);

	// Loop through batches & create the withdraw IX
	for (const chunk of holderArrChunks) {
		const txn = new anchor.web3.Transaction()
		txn.add(createWithdrawWithheldTokensFromAccountsInstruction(
			mint,
			ata,
			owner.publicKey,
			[],
			chunk,
			TOKEN_2022_PROGRAM_ID
		))

		const bhash = await connection.getLatestBlockhash("confirmed")
		txn.feePayer = owner.publicKey
		txn.recentBlockhash = bhash.blockhash

		const sig = sendAndConfirmTransaction(connection, txn, [owner], opts);
		console.log("Reclaim Signature: ", sig)
	}
}

export async function reclaimWithheldFromMint(connection, mint: web3.PublicKey, owner: web3.Keypair, opts = {}) {
	const ata = getAssociatedTokenAddressSync(mint, owner.publicKey, false, TOKEN_2022_PROGRAM_ID)
	const txn = new anchor.web3.Transaction()
	txn.add(createWithdrawWithheldTokensFromMintInstruction(mint, ata, owner.publicKey, [], TOKEN_2022_PROGRAM_ID))

	const bhash = await connection.getLatestBlockhash("confirmed")
	txn.feePayer = owner.publicKey
	txn.recentBlockhash = bhash.blockhash

	const sig = sendAndConfirmTransaction(connection, txn, [owner], opts);
	console.log("Mint Reclaim Signature: ", sig)
}