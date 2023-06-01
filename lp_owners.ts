import * as anchor from "@project-serum/anchor";
import {createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID} from "@solana/spl-token";
import {AddressLookupTableAccount, AddressLookupTableProgram, Connection, sendAndConfirmTransaction} from "@solana/web3.js";
import axios from "axios";
import {TokenSwapLayout} from "./token_swap/layouts";
import {web3} from "@project-serum/anchor";


describe("Burn analytics", () => {
	//Set Token Mint
	let tokenMint = new anchor.web3.PublicKey("CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo");

	let decimals = 5;

	//Enter RPC URL
	const connection = new Connection("https://rpc.hellomoon.io/f197c876-52d7-4566-bc4c-af4405029777", "confirmed")


	const SWAP_PROGRAM_ID = new anchor.web3.PublicKey("FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X")

	//Holds LP Owner -> True owner mapping
	const lpOwnerMap = {

	}

	it('Gets owners vs LP Pools', async () => {
		console.log("Checking token: ", tokenMint.toString())


		const accs = await getSwapPools(tokenMint)

		console.log("Pools: ", accs.length)

		const lp = []

		for (const acc of accs) {
			const holders = await connection.getTokenLargestAccounts(acc.account.tokenPool, "confirmed")
			lp.push(...holders.value.filter(h => h.uiAmount > 0).map((h) => h.address))

			const lpOwners = await connection.getMultipleParsedAccounts(lp, {commitment: "confirmed"})
			//@ts-ignore

			for(const h of lpOwners.value) {

				//@ts-ignore
				const ata = getAssociatedTokenAddressSync(tokenMint, new web3.PublicKey(h.data.parsed.info.owner), false, TOKEN_2022_PROGRAM_ID)

				//@ts-ignore
				lpOwnerMap[h.toString] = ata.toString()
			}
		}


		console.log(lpOwnerMap)


		//Check if LP owner is in map
		console.log("FIND 3XoZ1YL9m8cwfheBEb7JprXUCpqVXwnZJW9kJXbffttx =", lpOwnerMap["3XoZ1YL9m8cwfheBEb7JprXUCpqVXwnZJW9kJXbffttx"])

		//Expect: AZRMSXfBrGwpWHLC2ZPnbs4YdGD5ezvS1eAyDyRWt1E2
	})


	async function getSwapPools(tokenA) {
		const resp = await connection.getProgramAccounts(SWAP_PROGRAM_ID, {
			commitment: 'confirmed',
			filters: [
				{
					memcmp: {
						offset: 1 + 1 + 1 + 32 + 32 + 32 + 32,
						bytes: tokenA.toString(),
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
						bytes: tokenA.toString(),
					},
				},
			],
		})
		return resp.concat(respInverse).map((m) => {
			return {pubkey: m.pubkey, account: TokenSwapLayout.decode(m.account.data)}
		})
	}
})