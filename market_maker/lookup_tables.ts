import * as anchor from "@project-serum/anchor";
import {AddressLookupTableProgram, sendAndConfirmTransaction} from "@solana/web3.js";


export async function closeAllLookupTables(connection, owner) {

	const tables = await connection.getProgramAccounts(new anchor.web3.PublicKey("AddressLookupTab1e1111111111111111111111111"), {
		commitment: "confirmed",
		filters: [
			{
				memcmp: {
					offset: 22, //4 + 8 + 8 + 1 + 1
					bytes: owner.publicKey.toString(),
				}
			}
		]
	})

	console.log("Tables", tables.length)


	let txn = new anchor.web3.Transaction()
	for (let i = 0; i < tables.length; i++) {
		txn.add(closeAddressTableInstruction(owner, tables[i].pubkey))

		if (txn.instructions.length > 18) {
			const sig = await sendAndConfirmTransaction(connection, txn, [owner]);
			console.log("CLOSE LUT Sig: ", sig)

			//Reset txn for next round
			txn = new anchor.web3.Transaction()
		}
	}

	const sig = await sendAndConfirmTransaction(connection, txn, [owner])
	console.log("CLOSE LUT Sig: ", sig)
}

//Create a new LUT
export  async function createAddressTableInstruction(connection, owner, recentSlot = 0) {
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
export  async function extendAddressTableInstruction(owner, table: anchor.web3.PublicKey, addresses: anchor.web3.PublicKey[]) {
	return AddressLookupTableProgram.extendLookupTable({
		lookupTable: table,
		authority: owner.publicKey,
		payer: owner.publicKey,
		addresses: addresses,
	})
}


//Dispose of a LUT
export function closeAddressTableInstruction(owner, table: anchor.web3.PublicKey) {
	return AddressLookupTableProgram.closeLookupTable({
		authority: owner.publicKey,
		lookupTable: table,
		recipient: owner.publicKey
	})
}