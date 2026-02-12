
import { ButtonHTMLAttributes } from 'react'
import { clsx } from 'clsx'

export default function Button({className, ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {className?: string}){
  return (
    <button {...props} className={clsx('bg-primary text-white rounded px-4 py-2 hover:bg-primary-dark disabled:opacity-50', className)} />
  )
}
