import {getSwapPools} from "./util"


/**
 * Builds our mapping of LP Providers to their correct wallet addresses
 */
export async function buildLPProviderMaps(connection, tokenMint) {
	//So you have your pools
	const pools = await getSwapPools(connection, tokenMint)

	const lpAccountToPoolMap = {}
	const lpProviderMap = {}

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

	return {lpAccountToPoolMap, lpProviderMap}
}