import { type Chain } from '@/lib/types'

import BtcLogoImg from '../assets/images/btc-logo.svg?url'
import SpaceLogoImg from '../assets/icons-v3/space.svg?url'

import MetaletLogo from '../assets/images/metalet-logo-v3.svg?url'
import MvcSwapLogo from '../assets/images/mvcswap-logo.png?url'
import MVCUSDTLogo from '../assets/images/usdt-logo.jpg?url'
import ShowCoinLogo from '../assets/images/sc-logo.svg?url'
import MetaCoinLogo from '../assets/images/mc-circle.svg?url'
import XingnengLogo from '../assets/images/xingneng-logo.png'
// import FtDefaultLogo from '../assets/images/ft-default-icon.svg?url'

// brc20 logo
import BILILogo from '../assets/images/bili.jpg'
import BTCSLogo from '../assets/images/btcs.jpg'
import CATSLogo from '../assets/images/cats.jpg'
import FISHLogo from '../assets/images/fish.jpg'
import IBTCLogo from '../assets/images/ibtc.jpg'
import IGERLogo from '../assets/images/lger.jpg'
import ORDILogo from '../assets/images/ordi-logo.svg?url'
import RATSLogo from '../assets/images/rats.jpg'
import RDEXLogo from '../assets/images/rdex.jpg'
import SATSLogo from '../assets/images/sats.jpg'
import SAYCLogo from '../assets/images/sayc.jpg'
import TRACLogo from '../assets/images/trac.png'
import VMPXLogo from '../assets/images/vmpx.jpg'
import OXBTLogo from '../assets/images/oxbt.png'

const logos = {
  'localhost:3000': MetaletLogo,
  'mvcswap.com/': MvcSwapLogo,
}

export const getLogo = (name: string, chain: Chain) => {
  if (chain === 'btc') {
    if (name === 'BTC') {
      return BtcLogoImg
    } else {
      return getBRC20Logo(name)
    }
  } else if (chain === 'mvc') {
    if (name === 'SPACE') {
      return SpaceLogoImg
    } else {
      return getFTLogo(name)
    }
  }
}

export const getFTLogo = (name: string) => {
  switch (name) {
    case 'MVC USDT':
      return MVCUSDTLogo
    case 'MVCSWAP Token':
      return MvcSwapLogo
    case 'ShowCoin':
      return ShowCoinLogo
    case 'MetaCoin':
      return MetaCoinLogo
    case '星能':
      return XingnengLogo
    default:
      return
  }
}

export const getBRC20Logo = (name: string) => {
  switch (name.toLocaleUpperCase()) {
    case 'BILI':
      return BILILogo
    case 'BTCS':
      return BTCSLogo
    case 'CATS':
      return CATSLogo
    case 'FISH':
      return FISHLogo
    case 'IBTC':
      return IBTCLogo
    case 'IGER':
      return IGERLogo
    case 'ORDI':
      return ORDILogo
    case 'RATS':
      return RATSLogo
    case 'RDEX':
      return RDEXLogo
    case 'SATS':
      return SATSLogo
    case 'SAYC':
      return SAYCLogo
    case 'TRAC':
      return TRACLogo
    case 'VMPX':
      return VMPXLogo
    case 'OXBT':
      return OXBTLogo
    default:
      return
  }
}

export default logos
