import { TransactionImportanceBlockParams } from '../Transactions.js'
import { Erc1155OperatorChange, Erc20ApprovalChanges, Erc721OperatorChange, Erc721TokenIdApprovalChanges, Erc721or1155OperatorChanges } from '../SimulationSummary.js'
import { Erc721TokenApprovalChange, ERC20TokenApprovalChange, TokenVisualizerErc20Event, TokenVisualizerErc721Event, TokenVisualizerResultWithMetadata, TokenVisualizerNFTAllApprovalEvent } from '../../../types/visualizer-types.js'
import { EtherSymbol, TokenSymbol, TokenAmount, EtherAmount } from '../../subcomponents/coins.js'
import { RenameAddressCallBack } from '../../../types/user-interface-types.js'
import { SmallAddress } from '../../subcomponents/address.js'
import { assertNever } from '../../../utils/typescript.js'
import { RpcNetwork } from '../../../types/rpc.js'

type EtherTransferEventParams = {
	valueSent: bigint,
	totalReceived: bigint,
	textColor: string,
	rpcNetwork: RpcNetwork,
}

function EtherTransferEvent(param: EtherTransferEventParams) {
	return <>
		{ param.valueSent === 0n
			? <></>
			: <div class = 'vertical-center'>
				<div class = { `box token-box negative-box vertical-center` } style = 'display: inline-block'>
					<table class = 'log-table'>
						<div class = 'log-cell'>
							<p class = 'ellipsis' style = {`color: ${ param.textColor }; margin-bottom: 0px`}> Send&nbsp; </p>
						</div>
						<div class = 'log-cell' style = 'justify-content: right;'>
							<EtherAmount
								amount = { param.valueSent }
								style = { { color: param.textColor } }
								fontSize = 'normal'
							/>
						</div>
						<div class = 'log-cell'>
							<EtherSymbol
								style = { { color: param.textColor } }
								rpcNetwork = { param.rpcNetwork }
								fontSize = 'normal'
							/>
						</div>
					</table>
				</div>
			</div>
		}
		{ param.totalReceived <= 0n
			? <></>
			: <div class = 'vertical-center'>
				<div class = 'box token-box positive-box vertical-center' style = 'display: inline-block'>
					<table class = 'log-table'>
						<div class = 'log-cell'>
							<p class = 'ellipsis' style = {`color: ${ param.textColor }; margin-bottom: 0px`}> Receive&nbsp; </p>
						</div>
						<div class = 'log-cell' style = 'justify-content: right;'>
							<EtherAmount
								amount = { param.totalReceived }
								style = { { color: param.textColor } }
								fontSize = 'normal'
							/>
						</div>
						<div class = 'log-cell'>
							<EtherSymbol
								style = { { color: param.textColor } }
								rpcNetwork = { param.rpcNetwork }
								fontSize = 'normal'
							/>
						</div>
					</table>
				</div>
			</div>
		}
	</>
}

type SendOrReceiveTokensImportanceBoxParams = {
	sending: boolean,
	tokenVisualizerResults: TokenVisualizerResultWithMetadata[],
	textColor: string,
	renameAddressCallBack: RenameAddressCallBack,
}

export function tokenEventToTokenSymbolParams(tokenEvent: TokenVisualizerResultWithMetadata){
	switch(tokenEvent.type) {
		case 'ERC1155': return { tokenEntry: tokenEvent.token, tokenId: tokenEvent.tokenId, tokenIdName: tokenEvent.tokenIdName }
		case 'ERC20': return { tokenEntry: tokenEvent.token }
		case 'ERC721': return  { tokenEntry: tokenEvent.token, tokenId: tokenEvent.tokenId }
		case 'NFT All approval':  {
			if (tokenEvent.token.type === 'ERC1155') return { tokenEntry: tokenEvent.token, tokenId: undefined, tokenIdName: undefined }
			return { tokenEntry: tokenEvent.token, tokenId: undefined }
		}
		default: assertNever(tokenEvent)
	}
}

function SendOrReceiveTokensImportanceBox(param: SendOrReceiveTokensImportanceBoxParams) {
	return <>
		{ param.tokenVisualizerResults.map((tokenEvent) => (
			tokenEvent.isApproval ? <></> : <div class = 'vertical-center'>
				<div class = { `box token-box ${ param.sending ? 'negative-box' : 'positive-box' } vertical-center` } style = 'display: inline-block'>
					<table class = 'log-table'>
						<div class = 'log-cell'>
							<p class = 'ellipsis paragraph' style = { `color: ${ param.textColor }; margin-bottom: 0px; display: inline-block` }>
								{ param.sending ? 'Send' : 'Receive' }&nbsp;
							</p>
						</div>
						<div class = 'log-cell'>
							{ 'amount' in tokenEvent ?
								<TokenAmount
									amount = { tokenEvent.amount }
									{ ...'tokenId' in tokenEvent ? { tokenId: tokenEvent.tokenId } : {} }
									tokenEntry = { tokenEvent.token }
									style = { { color: param.textColor } }
									fontSize = 'normal'
								/>
							: <></>}
						</div>
						<div class = 'log-cell'>
							<TokenSymbol
								{ ...tokenEventToTokenSymbolParams(tokenEvent) }
								style = { { color: param.textColor } }
								useFullTokenName = { false }
								renameAddressCallBack = { param.renameAddressCallBack }
								fontSize = 'normal'
							/>
						</div>
						<div class = 'log-cell'>
							<p class = 'ellipsis paragraph' style = { `color: ${ param.textColor }; margin-bottom: 0px; display: inline-block` }>
								{ param.sending ? 'to' : 'from' }
							</p>
						</div>
						<div class = 'log-cell'>
							<SmallAddress 
								addressBookEntry = { param.sending ? tokenEvent.to : tokenEvent.from }
								renameAddressCallBack = { param.renameAddressCallBack }
							/>
						</div>
					</table>
				</div>
			</div>
		) ) }
	</>
}

export function CatchAllVisualizer(param: TransactionImportanceBlockParams) {
	const msgSender = param.simTx.transaction.from.address
	const sendingTokenResults = param.simTx.tokenResults.filter((x) => x.from.address === msgSender)
	const receivingTokenResults = param.simTx.tokenResults.filter((x) => x.to.address === msgSender)
	const erc20TokenApprovalChanges: ERC20TokenApprovalChange[] = sendingTokenResults.filter((x): x is TokenVisualizerErc20Event  => x.isApproval && x.type === 'ERC20').map((entry) => {
		return {
			...entry.token,
			approvals: [ {...entry.to, change: entry.amount } ]
		}
	})

	const operatorChanges: (Erc721OperatorChange | Erc1155OperatorChange)[] = sendingTokenResults.filter((x): x is TokenVisualizerNFTAllApprovalEvent  => x.type === 'NFT All approval').map((entry) => {
		return {
			...entry.token,
			operator: 'allApprovalAdded' in entry && entry.allApprovalAdded ? entry.to : undefined
		}
	})

	// token address, tokenId, approved address
	const tokenIdApprovalChanges: Erc721TokenApprovalChange[] = sendingTokenResults.filter((x): x is TokenVisualizerErc721Event  => 'tokenId' in x && x.isApproval).map((entry) => {
		return {
			tokenEntry: entry.token,
			tokenId: entry.tokenId,
			approvedEntry: entry.to
		}
	})

	const ownBalanceChanges = param.simTx.ethBalanceChanges.filter((change) => change.address.address === msgSender)
	const firstBalanceChanges = ownBalanceChanges[0]
	const lastBalanceChanges = ownBalanceChanges[ownBalanceChanges.length - 1]
	const totalEthReceived = firstBalanceChanges !== undefined && lastBalanceChanges !== undefined ? (ownBalanceChanges !== undefined && ownBalanceChanges.length > 0 ? lastBalanceChanges.after - firstBalanceChanges.before - param.simTx.transaction.value : 0n) : 0n

	if (param.simTx.transaction.to !== undefined
		&& param.simTx.transaction.value === 0n
		&& totalEthReceived <= 0n
		&& sendingTokenResults.length === 0
		&& receivingTokenResults.length === 0
	) {
		return <div class = 'notification transaction-importance-box'>
			<p class = 'paragraph'> { param.simTx.events.length == 0 ? 'The transaction does no visible important changes to your accounts.' : `The transaction does no visible important changes to your accounts, HOWEVER, it produces ${ param.simTx.events.length } event${ param.simTx.events.length === 1 ? '' : 's' }.`}</p>
		</div>
	}

	const textColor = 'var(--text-color)'

	return <div class = 'notification transaction-importance-box'>
		<div style = 'display: grid; grid-template-rows: max-content max-content' >
			{ /* contract creation */}
			{ param.simTx.transaction.to !== undefined ? <></> : <>
				<div class = 'log-cell' style = 'justify-content: left; display: grid;'>
					<p class = 'paragraph'> The transaction deploys a contract </p>
				</div>
			</> }
			{ /* sending ether / tokens */ }
			{ param.simTx.ethBalanceChanges.length > 0 ? 
				<div class = 'log-cell' style = 'justify-content: left; display: grid;'>
					<EtherTransferEvent
						valueSent = { param.simTx.transaction.value }
						totalReceived = { totalEthReceived }
						textColor = { textColor }
						rpcNetwork = { param.simulationAndVisualisationResults.rpcNetwork }
					/>
				</div>
				: <></>
			}

			<div class = 'log-cell' style = 'justify-content: left; display: grid;'>
				<SendOrReceiveTokensImportanceBox
					tokenVisualizerResults = { sendingTokenResults.filter( (x) => !x.isApproval) }
					sending = { true }
					textColor = { textColor }
					renameAddressCallBack = { param.renameAddressCallBack }
				/>
			</div>

			{ /* us approving other addresses */ }
			<div class = 'log-cell' style = 'justify-content: left; display: grid;'>
				<Erc20ApprovalChanges
					erc20TokenApprovalChanges = { erc20TokenApprovalChanges }
					textColor = { textColor }
					negativeColor = { textColor }
					isImportant = { true }
					renameAddressCallBack = { param.renameAddressCallBack }
				/>
			</div>
			<div class = 'log-cell' style = 'justify-content: left; display: grid;'>
				<Erc721or1155OperatorChanges
					erc721or1155OperatorChanges = { operatorChanges }
					textColor = { textColor }
					negativeColor = { textColor }
					isImportant = { true }
					renameAddressCallBack = { param.renameAddressCallBack }
				/>
			</div>
			<div class = 'log-cell' style = 'justify-content: left; display: grid;'>
				<Erc721TokenIdApprovalChanges
					Erc721TokenIdApprovalChanges = { tokenIdApprovalChanges }
					textColor = { textColor }
					negativeColor = { textColor }
					isImportant = { true }
					renameAddressCallBack = { param.renameAddressCallBack }
				/>
			</div>

			{ /* receiving tokens */ }
			<div class = 'log-cell' style = 'justify-content: left; display: grid;'>
				<SendOrReceiveTokensImportanceBox
					tokenVisualizerResults = { receivingTokenResults.filter( (x) => !x.isApproval) }
					sending = { false }
					textColor = { textColor }
					renameAddressCallBack = { param.renameAddressCallBack }
				/>
			</div>
		</div>
	</div>
}
