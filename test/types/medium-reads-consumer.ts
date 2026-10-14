import {
  readNativeName,
  decodeSignedActionError,
  type NativeNamesRpc,
  type NativeNameObservationV1,
} from '../../src/index.js'
import { readNativeName as namesRead } from '../../src/names.js'
import { decodeSignedActionError as errorsDecode } from '../../src/rpc-errors.js'
const rpc: NativeNamesRpc = {
  identity: () => 'fixture',
  request: async () => undefined,
}
const observation: Promise<NativeNameObservationV1> = readNativeName(
  rpc,
  { chainId: 1980 },
  'alice.ds',
)
void observation
void namesRead
void decodeSignedActionError(new Error())
void errorsDecode
