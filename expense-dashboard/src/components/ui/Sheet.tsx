/**
 * Sheet - Slide-out panel component
 * Based on shadcn/ui Sheet pattern with Radix Dialog
 */

import { Fragment, type ReactNode } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  side?: 'left' | 'right'
  className?: string
}

export function Sheet({ open, onClose, children, side = 'right', className }: SheetProps) {
  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40" />
        </Transition.Child>

        {/* Panel */}
        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className={cn(
              "pointer-events-none fixed inset-y-0 flex max-w-full",
              side === 'right' ? 'right-0' : 'left-0'
            )}>
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-out duration-200"
                enterFrom={side === 'right' ? 'translate-x-full' : '-translate-x-full'}
                enterTo="translate-x-0"
                leave="transform transition ease-in duration-150"
                leaveFrom="translate-x-0"
                leaveTo={side === 'right' ? 'translate-x-full' : '-translate-x-full'}
              >
                <Dialog.Panel className={cn(
                  "pointer-events-auto w-screen max-w-lg",
                  className
                )}>
                  <div className="flex h-full flex-col bg-white shadow-xl">
                    {children}
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}

interface SheetHeaderProps {
  children: ReactNode
  onClose: () => void
  className?: string
}

export function SheetHeader({ children, onClose, className }: SheetHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between px-4 py-3 border-b border-gray-200", className)}>
      <div className="flex-1">{children}</div>
      <button
        onClick={onClose}
        className="ml-4 rounded-md p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  )
}

interface SheetContentProps {
  children: ReactNode
  className?: string
}

export function SheetContent({ children, className }: SheetContentProps) {
  return (
    <div className={cn("flex-1 overflow-y-auto", className)}>
      {children}
    </div>
  )
}

interface SheetFooterProps {
  children: ReactNode
  className?: string
}

export function SheetFooter({ children, className }: SheetFooterProps) {
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3 border-t border-gray-200 bg-gray-50", className)}>
      {children}
    </div>
  )
}
