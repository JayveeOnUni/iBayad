import { Router } from 'express'
import {
  activateAccount,
  changePassword,
  forgotPassword,
  login,
  logout,
  me,
  refreshToken,
  resetPassword,
  verifyActivationToken,
} from '../controllers/authController'
import { authenticate } from '../middleware/auth'
import { loginRateLimiter } from '../middleware/loginRateLimiter'

const router = Router()

router.post('/login', loginRateLimiter, login)
router.post('/activate/verify', verifyActivationToken)
router.post('/activate', activateAccount)
router.post('/forgot-password', forgotPassword)
router.post('/reset-password', resetPassword)
router.post('/refresh', refreshToken)
router.post('/logout', authenticate, logout)
router.get('/me', authenticate, me)
router.put('/change-password', authenticate, changePassword)

export default router
