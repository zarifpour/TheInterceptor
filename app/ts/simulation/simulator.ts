import { EthereumClientService } from './services/EthereumClientService.js'
import { selfTokenOops } from './protectors/selfTokenOops.js'
import { EthereumBlockHeader } from '../types/wire-types.js'
import { bytes32String } from '../utils/bigint.js'
import { feeOops } from './protectors/feeOops.js'
import { commonTokenOops } from './protectors/commonTokenOops.js'
import { eoaApproval } from './protectors/eoaApproval.js'
import { eoaCalldata } from './protectors/eoaCalldata.js'
import { tokenToContract } from './protectors/tokenToContract.js'
import { WebsiteCreatedEthereumUnsignedTransaction, SimulationState, TokenVisualizerResult, MaybeParsedEvents, VisualizerResult, MaybeParsedEventWithExtraData } from '../types/visualizer-types.js'
import { EthereumJSONRpcRequestHandler } from './services/EthereumJSONRpcRequestHandler.js'
import { MulticallResponseEventLog, SingleMulticallResponse } from '../types/JsonRpc-types.js'
import { APPROVAL_LOG, DEPOSIT_LOG, ERC1155_TRANSFERBATCH_LOG, ERC1155_TRANSFERSINGLE_LOG, ERC721_APPROVAL_FOR_ALL_LOG, TRANSFER_LOG, WITHDRAWAL_LOG } from '../utils/constants.js'
import { handleApprovalLog, handleDepositLog, handleERC1155TransferBatch, handleERC1155TransferSingle, handleERC20TransferLog, handleErc721ApprovalForAllLog, handleWithdrawalLog } from './logHandlers.js'
import { RpcEntry } from '../types/rpc.js'
import { AddressBookEntryCategory, UserAddressBook } from '../types/addressBookTypes.js'
import { parseEventIfPossible } from './services/SimulationModeEthereumClientService.js'
import { Interface } from 'ethers'
import { extractAbi, extractFunctionArgumentTypes, removeTextBetweenBrackets } from '../utils/abi.js'
import { SolidityType } from '../types/solidityType.js'
import { parseSolidityValueByTypePure } from '../utils/solidityTypes.js'
import { identifyAddress } from '../background/metadataUtils.js'
import { sendToNonContact } from './protectors/sendToNonContactAddress.js'
import { assertNever } from '../utils/typescript.js'

const PROTECTORS = [
	selfTokenOops,
	commonTokenOops,
	feeOops,
	eoaApproval,
	eoaCalldata,
	tokenToContract,
	sendToNonContact,
]

type TokenLogHandler = (event: MulticallResponseEventLog) => TokenVisualizerResult[]

const getTokenEventHandler = (logSender: bigint, type: AddressBookEntryCategory, logSignature: string) => {
	const erc20LogHanders = new Map<string, TokenLogHandler>([
		[TRANSFER_LOG, handleERC20TransferLog],
		[APPROVAL_LOG, handleApprovalLog],
		[DEPOSIT_LOG, handleDepositLog],
		[WITHDRAWAL_LOG, handleWithdrawalLog],
	])
	const erc721LogHanders = new Map<string, TokenLogHandler>([
		[TRANSFER_LOG, handleERC20TransferLog],
		[APPROVAL_LOG, handleApprovalLog],
		[ERC721_APPROVAL_FOR_ALL_LOG, handleErc721ApprovalForAllLog],
	])
	const erc1155LogHanders = new Map<string, TokenLogHandler>([
		[ERC721_APPROVAL_FOR_ALL_LOG, handleErc721ApprovalForAllLog],
		[ERC1155_TRANSFERBATCH_LOG, handleERC1155TransferBatch],
		[ERC1155_TRANSFERSINGLE_LOG, handleERC1155TransferSingle],
	])

	switch (type) {
		case 'ERC1155': return erc1155LogHanders.get(logSignature)
		case 'ERC20': return erc20LogHanders.get(logSignature)
		case 'ERC721': return erc721LogHanders.get(logSignature)
		case 'activeAddress':
		case 'contact':
		case 'contract': {
			if (logSender === 0n) return erc20LogHanders.get(logSignature) // ETH logs
			return undefined
		}
		default: assertNever(type)
	} 
}

const parseEvents = async (singleMulticallResponse: SingleMulticallResponse, ethereumClientService: EthereumClientService, userAddressBook: UserAddressBook): Promise<MaybeParsedEvents> => {
	if (singleMulticallResponse.statusCode !== 'success' ) return []
	return await Promise.all(singleMulticallResponse.events.map(async (event) => {
		// todo, we should do this parsing earlier, to be able to add possible addresses to addressMetaData set
		const loggersAddressBookEntry = await identifyAddress(ethereumClientService, userAddressBook, event.loggersAddress)
		const abi = extractAbi(loggersAddressBookEntry, event.loggersAddress)
		const nonParsed = { ...event, isParsed: 'NonParsed' as const, loggersAddressBookEntry }
		if (abi === undefined) return nonParsed
		const parsed = parseEventIfPossible(new Interface(abi), event)
		if (parsed === null) return nonParsed
		const argTypes = extractFunctionArgumentTypes(parsed.signature)
		if (argTypes === undefined) return nonParsed
		if (parsed.args.length !== argTypes.length) return nonParsed
		
		const valuesWithTypes = parsed.args.map((value, index) => {
			const solidityType = argTypes[index]
			const paramName = parsed.fragment.inputs[index]?.name
			if (paramName === undefined) throw new Error(`missing parameter name`)
			if (solidityType === undefined) throw new Error(`unknown solidity type: ${ solidityType }`)
			const isArray = solidityType.includes('[')
			const verifiedSolidityType = SolidityType.safeParse(removeTextBetweenBrackets(solidityType))
			if (verifiedSolidityType.success === false) throw new Error(`unknown solidity type: ${ solidityType }`)
			return { paramName: paramName, typeValue: parseSolidityValueByTypePure(verifiedSolidityType.value, value, isArray) }
		})
		return {
			...event,
			isParsed: 'Parsed' as const,
			name: parsed.name,
			signature: parsed.signature,
			args: valuesWithTypes,
			loggersAddressBookEntry,
		}
	}))
}

export const visualizeTransaction = async (blockNumber: bigint, singleMulticallResponse: SingleMulticallResponse, userAddressBook: UserAddressBook, ethereumClientService: EthereumClientService): Promise<VisualizerResult> => {
	if (singleMulticallResponse.statusCode !== 'success') return { ethBalanceChanges: [], events: [], blockNumber }
	const parsedEvents = await parseEvents(singleMulticallResponse, ethereumClientService, userAddressBook)

	const events: MaybeParsedEventWithExtraData[][] = parsedEvents.map((parsedEvent) => {
		if (parsedEvent.isParsed === 'NonParsed') return [{ ...parsedEvent, type: 'NonParsed' }]
		const logSignature = parsedEvent.topics[0]
		if (logSignature === undefined) return [{ ...parsedEvent, type: 'Parsed' }]
		const tokenEventhandler = getTokenEventHandler(parsedEvent.loggersAddressBookEntry.address, parsedEvent.loggersAddressBookEntry.type, bytes32String(logSignature))
		if (tokenEventhandler === undefined) return [{ ...parsedEvent, type: 'Parsed' }]
		return tokenEventhandler(parsedEvent).map((tokenInformation) => ({ ...parsedEvent, type: 'TokenEvent', tokenInformation }))
	})
	return {
		ethBalanceChanges: singleMulticallResponse.balanceChanges,
		events: events.flat(),
		blockNumber
	}
}

export const runProtectorsForTransaction = async (simulationState: SimulationState, transaction: WebsiteCreatedEthereumUnsignedTransaction, ethereum: EthereumClientService) => {
	const reasonPromises = PROTECTORS.map(async (protectorMethod) => await protectorMethod(transaction.transaction, ethereum, simulationState))
	const reasons: (string | undefined)[] = await Promise.all(reasonPromises)
	const filteredReasons = reasons.filter((reason): reason is string => reason !== undefined)
	return {
		quarantine: filteredReasons.length > 0,
		quarantineReasons: Array.from(new Set<string>(filteredReasons)),
	}
}

export class Simulator {
	public ethereum: EthereumClientService

	public constructor(rpcNetwork: RpcEntry, newBlockAttemptCallback: (blockHeader: EthereumBlockHeader, ethereumClientService: EthereumClientService, isNewBlock: boolean, simulator: Simulator) => Promise<void>, onErrorBlockCallback: (ethereumClientService: EthereumClientService) => Promise<void>) {
		this.ethereum = new EthereumClientService(
			new EthereumJSONRpcRequestHandler(rpcNetwork, true),
			async (blockHeader: EthereumBlockHeader, ethereumClientService: EthereumClientService, isNewBlock: boolean) => await newBlockAttemptCallback(blockHeader, ethereumClientService, isNewBlock, this),
			onErrorBlockCallback
		)
	}

	public cleanup = () => this.ethereum.cleanup()

	public reset = (rpcNetwork: RpcEntry) => {
		this.cleanup()
		this.ethereum = new EthereumClientService(new EthereumJSONRpcRequestHandler(rpcNetwork), this.ethereum.getNewBlockAttemptCallback(), this.ethereum.getOnErrorBlockCallback())
	}
}
