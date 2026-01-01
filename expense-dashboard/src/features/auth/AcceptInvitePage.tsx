import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

interface InvitationDetails {
  email: string
  full_name: string
  role: string
  expires_at: string
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  bookkeeper: 'Bookkeeper',
  submitter: 'Submitter',
}

export function AcceptInvitePage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isValidating, setIsValidating] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  // Validate token on mount
  useEffect(() => {
    async function validateToken() {
      if (!token) {
        setError('Missing invitation token')
        setIsValidating(false)
        return
      }

      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/accept-invite?token=${token}`
        )

        const data = await response.json()

        if (!response.ok) {
          setError(data.error || 'Invalid invitation')
          setIsValidating(false)
          return
        }

        setInvitation(data)
      } catch (err) {
        setError('Failed to validate invitation')
      } finally {
        setIsValidating(false)
      }
    }

    validateToken()
  }, [token])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    // Validate password strength
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/accept-invite`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to create account')
        setIsSubmitting(false)
        return
      }

      setIsSuccess(true)

      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login')
      }, 3000)
    } catch (err) {
      setError('Failed to create account')
      setIsSubmitting(false)
    }
  }

  // Loading state
  if (isValidating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#119DA4] mx-auto mb-4" />
          <p className="text-gray-600">Validating invitation...</p>
        </div>
      </div>
    )
  }

  // Error state (invalid/expired token)
  if (error && !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <img
              src="https://as3.mx/wp-content/uploads/2025/06/AS3-Driver-Training-Logo-No-Disk.png"
              alt="AS3 Driver Training"
              className="h-16 mx-auto mb-4 object-contain"
            />
            <h1 className="text-2xl font-bold text-gray-900">Expense Dashboard</h1>
          </div>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                <h2 className="text-lg font-semibold text-gray-900 mb-2">
                  Invitation Not Valid
                </h2>
                <p className="text-gray-600 mb-6">{error}</p>
                <Button onClick={() => navigate('/login')} variant="outline">
                  Go to Login
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // Success state
  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <img
              src="https://as3.mx/wp-content/uploads/2025/06/AS3-Driver-Training-Logo-No-Disk.png"
              alt="AS3 Driver Training"
              className="h-16 mx-auto mb-4 object-contain"
            />
            <h1 className="text-2xl font-bold text-gray-900">Expense Dashboard</h1>
          </div>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                <h2 className="text-lg font-semibold text-gray-900 mb-2">
                  Account Created!
                </h2>
                <p className="text-gray-600 mb-2">
                  Your account has been set up successfully.
                </p>
                <p className="text-sm text-gray-500">
                  Redirecting to login...
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // Password setup form
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img
            src="https://as3.mx/wp-content/uploads/2025/06/AS3-Driver-Training-Logo-No-Disk.png"
            alt="AS3 Driver Training"
            className="h-16 mx-auto mb-4 object-contain"
          />
          <h1 className="text-2xl font-bold text-gray-900">Expense Dashboard</h1>
          <p className="mt-2 text-gray-600">Set up your account</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Welcome, {invitation?.full_name}!</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Invitation details */}
            <div className="mb-6 p-4 bg-teal-50 rounded-lg border border-teal-100">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Email:</span>
                  <span className="font-medium text-gray-900">{invitation?.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Role:</span>
                  <span className="font-medium text-[#119DA4]">
                    {ROLE_LABELS[invitation?.role || ''] || invitation?.role}
                  </span>
                </div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
                required
                autoComplete="new-password"
              />

              <Input
                label="Confirm Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
                autoComplete="new-password"
              />

              <p className="text-xs text-gray-500">
                Password must be at least 8 characters long
              </p>

              <Button
                type="submit"
                className="w-full"
                isLoading={isSubmitting}
                disabled={isSubmitting}
              >
                Create Account
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
