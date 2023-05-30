export const errors = [
	{
		"code": 6000,
		"name": "AlreadyInUse",
		"msg": "Error: Swap account already in use"
	},
	{
		"code": 6001,
		"name": "InvalidProgramAddress",
		"msg": "Error: Invalid program address generated from bump seed and key"
	},
	{
		"code": 6002,
		"name": "InvalidOwner",
		"msg": "Error: The input account owner is not the program address"
	},
	{
		"code": 6003,
		"name": "InvalidOutputOwner",
		"msg": "Error: Output pool account owner cannot be the program address"
	},
	{
		"code": 6004,
		"name": "ExpectedMint",
		"msg": "Error: Deserialized account is not an SPL Token mint"
	},
	{
		"code": 6005,
		"name": "ExpectedAccount",
		"msg": "Error: Deserialized account is not an SPL Token account"
	},
	{
		"code": 6006,
		"name": "EmptySupply",
		"msg": "Error: Input token account empty"
	},
	{
		"code": 6007,
		"name": "InvalidSupply",
		"msg": "Error: Pool token mint has a non-zero supply"
	},
	{
		"code": 6008,
		"name": "RepeatedMint",
		"msg": "Error: Swap input token accounts have the same mint"
	},
	{
		"code": 6009,
		"name": "InvalidDelegate",
		"msg": "Error: Token account has a delegate"
	},
	{
		"code": 6010,
		"name": "InvalidInput",
		"msg": "Error: InvalidInput"
	},
	{
		"code": 6011,
		"name": "IncorrectSwapAccount",
		"msg": "Error: Address of the provided swap token account is incorrect"
	},
	{
		"code": 6012,
		"name": "IncorrectPoolMint",
		"msg": "Error: Address of the provided pool token mint is incorrect"
	},
	{
		"code": 6013,
		"name": "InvalidOutput",
		"msg": "Error: InvalidOutput"
	},
	{
		"code": 6014,
		"name": "CalculationFailure",
		"msg": "Error: CalculationFailure"
	},
	{
		"code": 6015,
		"name": "InvalidInstruction",
		"msg": "Error: InvalidInstruction"
	},
	{
		"code": 6016,
		"name": "ExceededSlippage",
		"msg": "Error: Swap instruction exceeds desired slippage limit"
	},
	{
		"code": 6017,
		"name": "InvalidCloseAuthority",
		"msg": "Error: Token account has a close authority"
	},
	{
		"code": 6018,
		"name": "InvalidFreezeAuthority",
		"msg": "Error: Pool token mint has a freeze authority"
	},
	{
		"code": 6019,
		"name": "IncorrectFeeAccount",
		"msg": "Error: Pool fee token account incorrect"
	},
	{
		"code": 6020,
		"name": "ZeroTradingTokens",
		"msg": "Error: Given pool token amount results in zero trading tokens"
	},
	{
		"code": 6021,
		"name": "FeeCalculationFailure",
		"msg": "Error: The fee calculation failed due to overflow, underflow, or unexpected 0"
	},
	{
		"code": 6022,
		"name": "ConversionFailure",
		"msg": "Error: Conversion to or from u64 failed."
	},
	{
		"code": 6023,
		"name": "InvalidFee",
		"msg": "Error: The provided fee does not match the program owner's constraints"
	},
	{
		"code": 6024,
		"name": "IncorrectTokenProgramId",
		"msg": "Error: The provided token program does not match the token program expected by the swap"
	},
	{
		"code": 6025,
		"name": "UnsupportedCurveType",
		"msg": "Error: The provided curve type is not supported by the program owner"
	},
	{
		"code": 6026,
		"name": "InvalidCurve",
		"msg": "Error: The provided curve parameters are invalid"
	},
	{
		"code": 6027,
		"name": "UnsupportedCurveOperation",
		"msg": "Error: The operation cannot be performed on the given curve"
	},
	{
		"code": 6028,
		"name": "InvalidFeeAccount",
		"msg": "Error: The pool fee account is invalid"
	}
]

export function parseCustomError(err: string) {
	const search = "custom program error: "
	if (err.indexOf(search) < 0)
		return err

	const cerr = err.slice(err.indexOf(search) + search.length)
	return errors[parseInt(cerr)] || err
}

export function parseCustomErrorInt(errCode: number) {
	return errors[errCode]
}