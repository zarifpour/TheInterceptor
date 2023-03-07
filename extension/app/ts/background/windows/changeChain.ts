import { METAMASK_ERROR_USER_REJECTED_REQUEST } from '../../utils/constants.js'
import { Future } from '../../utils/future.js'
import { ChainChangeConfirmation, InterceptedRequest, PopupMessage, SignerChainChangeConfirmation, WebsiteSocket, } from '../../utils/interceptor-messages.js'
import { Website } from '../../utils/user-interface-types.js'
import { changeActiveChain, sendMessageToContentScript } from '../background.js'
import { getHtmlFile, sendPopupMessageToOpenWindows } from '../backgroundUtils.js'
import { getChainChangeConfirmationPromise, saveChainChangeConfirmationPromise } from '../settings.js'

let pendForUserReply: Future<ChainChangeConfirmation> | undefined = undefined
let pendForSignerReply: Future<SignerChainChangeConfirmation> | undefined = undefined

let openedWindow: browser.windows.Window | null = null

export async function resolveChainChange(confirmation: ChainChangeConfirmation) {
	if (pendForUserReply !== undefined) {
		pendForUserReply.resolve(confirmation)
	} else {
		const data = await getChainChangeConfirmationPromise()
		if (data === undefined || confirmation.options.requestId !== data.request.requestId) return
		const resolved = await resolve(confirmation, data.simulationMode)
		sendMessageToContentScript(data.socket, resolved, data.request)
	}
	pendForUserReply = undefined
}

export async function resolveSignerChainChange(confirmation: SignerChainChangeConfirmation) {
	if (pendForSignerReply !== undefined) pendForSignerReply.resolve(confirmation)
	pendForSignerReply = undefined
}

function rejectMessage(requestId: number) {
	return {
		method: 'popup_changeChainDialog',
		options: {
			requestId,
			accept: false,
		},
	} as const
}

const userDeniedChange = {
	error: {
		code: METAMASK_ERROR_USER_REJECTED_REQUEST,
		message: 'User denied the chain change.',
	}
} as const

export const openChangeChainDialog = async (
	socket: WebsiteSocket,
	request: InterceptedRequest,
	simulationMode: boolean,
	website: Website,
	chainId: bigint
) => {
	if (openedWindow !== null || pendForUserReply || pendForSignerReply) {
		return userDeniedChange
	}
	const oldPromise = await getChainChangeConfirmationPromise()
	if (oldPromise !== undefined) {
		if ((await chrome.tabs.query({ windowId: oldPromise.dialogId })).length > 0) {
			return userDeniedChange
		} else {
			await saveChainChangeConfirmationPromise(undefined)
		}
	}

	pendForUserReply = new Future<ChainChangeConfirmation>()

	const changeChainWindowReadyAndListening = async function popupMessageListener(msg: unknown) {
		const message = PopupMessage.parse(msg)
		if ( message.method !== 'popup_changeChainReadyAndListening') return
		browser.runtime.onMessage.removeListener(changeChainWindowReadyAndListening)
		return sendPopupMessageToOpenWindows({
			method: 'popup_ChangeChainRequest',
			data: {
				requestId: request.requestId,
				chainId: chainId,
				website: website,
				simulationMode: simulationMode,
			}
		})
	}
	browser.runtime.onMessage.addListener(changeChainWindowReadyAndListening)

	openedWindow = await browser.windows.create(
		{
			url: getHtmlFile('changeChain'),
			type: 'popup',
			height: 400,
			width: 520,
		}
	)

	if (openedWindow && openedWindow.id !== undefined) {
		const windowClosed = () => { // check if user has closed the window on their own, if so, reject signature
			browser.windows.onRemoved.removeListener(windowClosed)
			openedWindow = null
			if (pendForUserReply === undefined) return
			resolveChainChange(rejectMessage(request.requestId))
		}
		browser.windows.onRemoved.addListener(windowClosed)

		saveChainChangeConfirmationPromise({
			website: website,
			dialogId: openedWindow.id,
			socket: socket,
			request: request,
			simulationMode: simulationMode,
		})
	} else {
		resolveChainChange(rejectMessage(request.requestId))
	}
	pendForSignerReply = undefined

	const reply = await pendForUserReply

	// forward message to content script
	return resolve(reply, simulationMode)
}

async function resolve(reply: ChainChangeConfirmation, simulationMode: boolean) {
	await saveChainChangeConfirmationPromise(undefined)
	if (reply.options.accept) {
		if (simulationMode) {
			await changeActiveChain(reply.options.chainId)
			return { result: null }
		}
		pendForSignerReply = new Future<SignerChainChangeConfirmation>() // when not in simulation mode, we need to get reply from the signer too
		await changeActiveChain(reply.options.chainId)
		const signerReply = await pendForSignerReply
		if (signerReply.options.accept && signerReply.options.chainId === reply.options.chainId) {
			return { result: null }
		}
	}
	return userDeniedChange
}
