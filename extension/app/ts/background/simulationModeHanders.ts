import { Simulator } from '../simulation/simulator.js'
import { bytes32String } from '../utils/bigint.js'
import { KNOWN_CONTRACT_CALLER_ADDRESSES } from '../utils/constants.js'
import { InterceptedRequest, Settings, WebsiteAccessArray } from '../utils/interceptor-messages.js'
import { Website, WebsiteSocket, WebsiteTabConnections } from '../utils/user-interface-types.js'
import { EstimateGasParams, EthBalanceParams, EthBlockByNumberParams, EthCallParams, EthereumAddress, EthereumData, EthereumQuantity, EthereumSignedTransactionWithBlockData, EthGetLogsParams, EthGetLogsResponse, EthSubscribeParams, EthTransactionReceiptResponse, EthUnSubscribeParams, GetBlockReturn, GetCode, GetSimulationStack, GetSimulationStackReply, GetTransactionCount, JsonRpcNewHeadsNotification, NewHeadsSubscriptionData, PersonalSignParams, SendTransactionParams, SignTypedDataParams, SwitchEthereumChainParams, TransactionByHashParams, TransactionReceiptParams } from '../utils/wire-types.js'
import { getConnectionDetails } from './accessManagement.js'
import { postMessageIfStillConnected } from './background.js'
import { openChangeChainDialog } from './windows/changeChain.js'
import { openConfirmTransactionDialog } from './windows/confirmTransaction.js'
import { openPersonalSignDialog } from './windows/personalSign.js'

const defaultCallAddress = 0x1n

export async function getBlockByNumber(simulator: Simulator, request: EthBlockByNumberParams) {
	const block = await simulator.simulationModeNode.getBlock(request.params[0], request.params[1])
	return { result: GetBlockReturn.serialize(block) }
}
export async function getBalance(simulator: Simulator, request: EthBalanceParams) {
	return { result: EthereumQuantity.serialize(await simulator.simulationModeNode.getBalance(request.params[0])) }
}
export async function getTransactionByHash(simulator: Simulator, request: TransactionByHashParams) {
	const result = await simulator.simulationModeNode.getTransactionByHash(request.params[0])
	if (result === undefined) return { result: undefined }
	return { result: EthereumSignedTransactionWithBlockData.serialize(result) }
}
export async function getTransactionReceipt(simulator: Simulator, request: TransactionReceiptParams) {
	return { result: EthTransactionReceiptResponse.serialize(await simulator.simulationModeNode.getTransactionReceipt(request.params[0])) }
}

function getFromField(websiteTabConnections: WebsiteTabConnections, simulationMode: boolean, request: SendTransactionParams, getActiveAddressForDomain: (websiteAccess: WebsiteAccessArray, websiteOrigin: string, settings: Settings) => bigint | undefined, socket: WebsiteSocket, settings: Settings) {
	if (simulationMode && 'from' in request.params[0] && request.params[0].from !== undefined) {
		return request.params[0].from // use `from` field directly from the dapp if we are in simulation mode and its available
	} else {
		const connection = getConnectionDetails(websiteTabConnections, socket)
		if (connection === undefined) throw new Error('Not connected')

		const from = getActiveAddressForDomain(settings.websiteAccess, connection.websiteOrigin, settings)
		if (from === undefined) throw new Error('Access to active address is denied')
		return from
	}
}

export async function sendTransaction(
	websiteTabConnections: WebsiteTabConnections,
	getActiveAddressForDomain: (websiteAccess: WebsiteAccessArray, websiteOrigin: string, settings: Settings) => bigint | undefined,
	simulator: Simulator,
	sendTransactionParams: SendTransactionParams,
	socket: WebsiteSocket,
	request: InterceptedRequest,
	simulationMode: boolean = true,
	website: Website,
	settings: Settings,
) {
	async function formTransaction() {
		const block = simulator.ethereum.getBlock()
		const chainId = simulator.ethereum.getChainId()
		const from = getFromField(websiteTabConnections, simulationMode, sendTransactionParams, getActiveAddressForDomain, socket, settings)
		const transactionCount = simulator.simulationModeNode.getTransactionCount(from)

		const maxFeePerGas = (await block).baseFeePerGas * 2n
		return {
			type: '1559' as const,
			from: from,
			chainId: await chainId,
			nonce: await transactionCount,
			maxFeePerGas: sendTransactionParams.params[0].maxFeePerGas ? sendTransactionParams.params[0].maxFeePerGas : maxFeePerGas,
			maxPriorityFeePerGas: sendTransactionParams.params[0].maxPriorityFeePerGas ? sendTransactionParams.params[0].maxPriorityFeePerGas : 1n,
			gas: sendTransactionParams.params[0].gas ? sendTransactionParams.params[0].gas : 90000n,
			to: sendTransactionParams.params[0].to === undefined ? null : sendTransactionParams.params[0].to,
			value: sendTransactionParams.params[0].value ? sendTransactionParams.params[0].value : 0n,
			input: 'data' in sendTransactionParams.params[0] && sendTransactionParams.params[0].data !== undefined ? sendTransactionParams.params[0].data : new Uint8Array(),
			accessList: []
		}
	}
	return await openConfirmTransactionDialog(
		websiteTabConnections,
		socket,
		request,
		website,
		simulationMode,
		formTransaction,
		settings,
	)
}

async function singleCallWithFromOverride(simulator: Simulator, request: EthCallParams, from: bigint) {
	const callParams = request.params[0]
	const blockTag = request.params.length > 1 ? request.params[1] : 'latest' as const
	const input = callParams.data !== undefined ? callParams.data : new Uint8Array()
	const gasPrice = callParams.gasPrice !== undefined ? callParams.gasPrice : 0n
	const value = callParams.value !== undefined ? callParams.value : 0n
	const transaction = {
		type: '1559' as const,
		from,
		chainId: await simulator.ethereum.getChainId(),
		nonce: await simulator.simulationModeNode.getTransactionCount(from),
		maxFeePerGas: gasPrice,
		maxPriorityFeePerGas: 0n,
		gasLimit: callParams.gas !== undefined ? callParams.gas : await simulator.simulationModeNode.estimateGas({
			from,
			to: callParams.to,
			data: input,
			gasPrice,
			value,
		}),
		to: callParams.to === undefined ? null : callParams.to,
		value,
		input,
		accessList: [],
	}
	return await simulator.simulationModeNode.call(transaction, blockTag)
}

export async function call(simulator: Simulator, request: EthCallParams) {
	const callParams = request.params[0]
	const from = callParams.from !== undefined && !KNOWN_CONTRACT_CALLER_ADDRESSES.includes(callParams.from) ? callParams.from : defaultCallAddress
	const callResult = await singleCallWithFromOverride(simulator, request, from)

	// if we fail our call because we are calling from a contract, retry and change address to our default calling address
	// TODO: Remove this logic and KNOWN_CONTRACT_CALLER_ADDRESSES when multicall supports calling from contracts
	if ('error' in callResult && callResult.error?.data === 'sender has deployed code' && from !== defaultCallAddress) {
		return await singleCallWithFromOverride(simulator, request, defaultCallAddress)
	}
	return callResult
}

export async function blockNumber(simulator: Simulator) {
	const block = await simulator.simulationModeNode.getBlockNumber()
	return { result: bytes32String(block) }
}

export async function estimateGas(simulator: Simulator, request: EstimateGasParams) {
	return { result: EthereumQuantity.serialize(await simulator.simulationModeNode.estimateGas(request.params[0])) }
}

export async function subscribe(websiteTabConnections: WebsiteTabConnections, simulator: Simulator, socket: WebsiteSocket, request: EthSubscribeParams) {
	const result = await simulator.simulationModeNode.createSubscription(request, (subscriptionId: string, reply: JsonRpcNewHeadsNotification) => {
		return postMessageIfStillConnected(websiteTabConnections, socket, {
			interceptorApproved: true,
			options: request,
			result: NewHeadsSubscriptionData.serialize(reply.params),
			subscription: subscriptionId
		})
	})

	if (result === undefined) throw new Error('failed to create subscription')

	return { result: result }
}

export async function unsubscribe(simulator: Simulator, request: EthUnSubscribeParams) {
	return { result: simulator.simulationModeNode.remoteSubscription(request.params[0]) }
}

export async function getAccounts(websiteTabConnections: WebsiteTabConnections, getActiveAddressForDomain: (websiteAccess: WebsiteAccessArray, websiteOrigin: string, settings: Settings) => bigint | undefined, _simulator: Simulator, socket: WebsiteSocket, settings: Settings) {
	const connection = getConnectionDetails(websiteTabConnections, socket)
	if (connection === undefined) {
		return { result: [] }
	}
	const account = getActiveAddressForDomain(settings.websiteAccess, connection.websiteOrigin, settings)
	if (account === undefined) {
		return { result: [] }
	}

	return { result: [EthereumAddress.serialize(account)] }
}

export async function chainId(simulator: Simulator) {
	return { result: EthereumQuantity.serialize(await simulator.ethereum.getChainId()) }
}

export async function gasPrice(simulator: Simulator) {
	return { result: EthereumQuantity.serialize(await simulator.ethereum.getGasPrice()) }
}

export async function personalSign(websiteTabConnections: WebsiteTabConnections, socket: WebsiteSocket, params: PersonalSignParams | SignTypedDataParams, request: InterceptedRequest, simulationMode: boolean, website: Website, settings: Settings) {
	return await openPersonalSignDialog(websiteTabConnections, socket, params, request, simulationMode, website, settings)
}

export async function switchEthereumChain(websiteTabConnections: WebsiteTabConnections, socket: WebsiteSocket, simulator: Simulator, params: SwitchEthereumChainParams, request: InterceptedRequest, simulationMode: boolean, website: Website) {
	if (await simulator.ethereum.getChainId() === params.params[0].chainId) {
		// we are already on the right chain
		return { result: null }
	}
	return await openChangeChainDialog(websiteTabConnections, socket, request, simulationMode, website, params.params[0].chainId)
}

export async function getCode(simulator: Simulator, request: GetCode) {
	return { result: EthereumData.serialize(await simulator.simulationModeNode.getCode(request.params[0], request.params[1])) }
}

export async function requestPermissions(websiteTabConnections: WebsiteTabConnections, getActiveAddressForDomain: (websiteAccess: WebsiteAccessArray, websiteOrigin: string, settings: Settings) => bigint | undefined, simulator: Simulator, socket: WebsiteSocket, settings: Settings) {
	return await getAccounts(websiteTabConnections, getActiveAddressForDomain, simulator, socket, settings)
}

export async function getPermissions() {
	return { result: [ { "eth_accounts": {} } ] }
}

export async function getTransactionCount(simulator: Simulator, request: GetTransactionCount) {
	return { result: EthereumQuantity.serialize(await simulator.simulationModeNode.getTransactionCount(request.params[0], request.params[1])) }
}

export async function getSimulationStack(simulator: Simulator, request: GetSimulationStack) {
	switch (request.params[0]) {
		case '1.0.0': return {
			result: {
				version: '1.0.0',
				payload: GetSimulationStackReply.serialize(simulator.simulationModeNode.getSimulationStack()),
			}
		}
	}
}

export async function getLogs(simulator: Simulator, request: EthGetLogsParams) {
	return { result: EthGetLogsResponse.serialize(await simulator.simulationModeNode.getLogs(request.params[0])) }
}
