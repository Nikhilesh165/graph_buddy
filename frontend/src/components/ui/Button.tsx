import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
export type ButtonSize = 'xs' | 'sm' | 'default' | 'lg' | 'icon' | 'icon-sm' | 'icon-xs'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default:
    'bg-primary text-primary-foreground shadow-sm hover:bg-[color-mix(in_oklab,var(--primary),white_10%)] active:bg-[color-mix(in_oklab,var(--primary),black_8%)]',
  secondary:
    'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklab,var(--secondary),var(--foreground)_7%)]',
  outline: 'border border-border-strong bg-transparent text-foreground hover:bg-hover',
  ghost: 'text-muted-foreground hover:bg-hover hover:text-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
  link: 'h-auto px-0 text-accent-foreground underline-offset-4 hover:underline',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'h-6 gap-1 rounded-sm px-2 text-xs',
  sm: 'h-7 px-2.5 text-[13px]',
  default: 'h-8 px-3 text-[13px]',
  lg: 'h-9 px-4 text-sm',
  icon: 'h-8 w-8',
  'icon-sm': 'h-7 w-7',
  'icon-xs': 'h-6 w-6 rounded-sm',
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

/** Shared button primitive -- shadcn-style variant/size props, hand-rolled
 * (no class-variance-authority) to keep the dependency list small. Sized
 * for a dense desktop UI (Obsidian's controls are 28-32px tall). */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = 'default', size = 'default', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium',
        'transition-[background-color,color,opacity,box-shadow] duration-150 disabled:pointer-events-none disabled:opacity-45',
        '[&_svg]:shrink-0',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  )
})
