import * as anchor from "@project-serum/anchor";
import {createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID} from "@solana/spl-token";
import {AddressLookupTableAccount, AddressLookupTableProgram, Connection, sendAndConfirmTransaction} from "@solana/web3.js";
import axios from "axios";


describe("Burn analytics", () => {
	//Set Token Mint
	let tokenMint = new anchor.web3.PublicKey("CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo");

	let decimals = 5;

	//Enter RPC URL
	const connection = new Connection("https://rpc.hellomoon.io/f197c876-52d7-4566-bc4c-af4405029777", "confirmed")


	it('Calculates Withheld token amounts', async () => {
		console.log("Checking token: ", tokenMint.toString())

		//TODO Note that this will only work temporarily until the RPC providers cotton on ;)
		//Fallback is to call accounts from fluxbeam /holders api
		const resp = await connection.getParsedProgramAccounts(TOKEN_2022_PROGRAM_ID, {
			commitment: "confirmed",
			filters: [
				{memcmp: {
						offset:0,
						bytes: tokenMint.toString()
					}}
			]
		})

		console.log("Accounts: ", resp.length)

		let total = 0
		for (const acc of resp) {
			//@ts-ignore
			for(const ext of acc.account.data?.parsed?.info.extensions) {
				if (ext.extension === "transferFeeAmount")
					total += ext.state.withheldAmount
			}
		}

		console.log("Withheld Amount:", total)
		console.log("Withheld Amount Normalised:", total / Math.pow(10,decimals))
	})
})