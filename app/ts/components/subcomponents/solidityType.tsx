import { AddressBookEntry } from '../../types/addressBookTypes.js'
import { EnrichedGroupedSolidityType, PureGroupedSolidityType } from '../../types/solidityType.js'
import { RenameAddressCallBack } from '../../types/user-interface-types.js'
import { checksummedAddress, dataStringWith0xStart } from '../../utils/bigint.js'
import { assertNever } from '../../utils/typescript.js'
import { getAddressBookEntryOrAFiller } from '../ui-utils.js'
import { SmallAddress } from './address.js'

const textStyle = 'text-overflow: ellipsis; overflow: hidden;'
const StringElement = ({ text }: { text: string }) => <p class = 'paragraph' style = { textStyle }>{ text }</p>

export function PureSolidityTypeComponent( { valueType }: { valueType: PureGroupedSolidityType }) {
	switch(valueType.type) {
		case 'address': return <StringElement text = { checksummedAddress(valueType.value) } />
		case 'bool': return <StringElement text = { valueType.value === true ? 'True' : 'False' } />
		case 'bytes': return <div class = 'textbox' style = 'white-space: normal;'> <p class = 'paragraph' style = 'color: var(--subtitle-text-color)'>{ dataStringWith0xStart(valueType.value) }</p> </div>
		case 'fixedBytes': return <StringElement text = { dataStringWith0xStart(valueType.value) } />
		case 'integer': return <StringElement text = { valueType.value.toString() } />
		case 'string': return <StringElement text = { `"${ valueType.value }"` } />
		case 'address[]': return <StringElement text = { `[${ valueType.value.map((value) => checksummedAddress(value)).toString() }]` } />
		case 'bool[]': return <StringElement text = { `[ ${ valueType.value.map((a) => a === true ? 'True' : 'False' ).toString() }]` } />
		case 'bytes[]': return <> { valueType.value.map((value) => <div class = 'textbox' style = 'white-space: normal;'> <p class = 'paragraph' style = 'color: var(--subtitle-text-color)'>{ dataStringWith0xStart(value) }</p> </div>) } </>
		case 'fixedBytes[]': return <StringElement text = { `[ ${ valueType.value.toString() }]` } />
		case 'integer[]': return <StringElement text = { `[ ${ valueType.value.toString() }]` } />
		case 'string[]': return <StringElement text = { `[${ valueType.value.map((a) => `"${ a }"`) }]` } />
		default: assertNever(valueType)
	}
}

export function EnrichedSolidityTypeComponentWithAddressBook({ valueType, addressMetaData, renameAddressCallBack }: { valueType: PureGroupedSolidityType, addressMetaData: readonly AddressBookEntry[], renameAddressCallBack: RenameAddressCallBack }) {
	switch(valueType.type) {
		case 'address': return <SmallAddress addressBookEntry = { getAddressBookEntryOrAFiller(addressMetaData, valueType.value) } renameAddressCallBack = { renameAddressCallBack } />
		case 'address[]': return <>{ valueType.value.map((value) => <SmallAddress addressBookEntry = { getAddressBookEntryOrAFiller(addressMetaData, value) } renameAddressCallBack = { renameAddressCallBack } />) }</>
		default: return <PureSolidityTypeComponent valueType = { valueType } />
	}
}

export function EnrichedSolidityTypeComponent({ valueType, renameAddressCallBack }: { valueType: EnrichedGroupedSolidityType, renameAddressCallBack: RenameAddressCallBack }) {
	switch(valueType.type) {
		case 'address': return <SmallAddress addressBookEntry = { valueType.value } renameAddressCallBack = { renameAddressCallBack } />
		case 'address[]': return <>{ valueType.value.map((value) => <SmallAddress addressBookEntry = { value } renameAddressCallBack = { renameAddressCallBack } />) }</>
		default: return <PureSolidityTypeComponent valueType = { valueType } />
	}
}
