import { JSX } from 'react'
import { IconBaseProps } from 'react-icons'

function MihomoIcon(props: IconBaseProps): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
      <rect x="15" y="9" width="10" height="46" rx="5" fill="currentColor" />
      <path
        d="M25 9h14.5C48.06 9 55 15.94 55 24.5S48.06 40 39.5 40H25V9Z"
        fill="currentColor"
      />
      <rect x="29" y="15" width="11" height="12" rx="5.5" fill="white" />
    </svg>
  )
}

export default MihomoIcon
