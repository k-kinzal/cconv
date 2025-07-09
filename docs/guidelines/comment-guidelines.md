# Comment Guidelines

This document outlines the commenting standards for our codebase to ensure consistency, maintainability, and clarity across all projects.

## Core Principles

### 1. Write Comments in English

**All comments must be written in English**, regardless of the team's primary language or location. This ensures:
- Accessibility for international team members
- Consistency across the codebase
- Better collaboration with external developers
- Easier onboarding for new team members

```typescript
// ❌ Bad
// ユーザー認証を検証する
function validateAuth(token: string): boolean {
  // トークンの有効期限をチェック
  return token.exp > Date.now();
}

// ✅ Good
// Validates user authentication
function validateAuth(token: string): boolean {
  // Check token expiration
  return token.exp > Date.now();
}
```

### 2. Use TSDoc Format for Documentation

**All public functions, classes, and interfaces must include TSDoc comments** to provide clear API documentation.

```typescript
/**
 * Calculates the total price including tax
 * @param basePrice - The original price before tax
 * @param taxRate - Tax rate as a decimal (e.g., 0.08 for 8%)
 * @returns The total price including tax
 * @example
 * ```typescript
 * const total = calculateTotalPrice(100, 0.08); // Returns 108
 * ```
 */
function calculateTotalPrice(basePrice: number, taxRate: number): number {
  return basePrice * (1 + taxRate);
}

/**
 * User authentication service
 */
export class AuthService {
  /**
   * Validates a JWT token
   * @param token - The JWT token to validate
   * @throws {AuthError} When token is invalid or expired
   */
  validateToken(token: string): boolean {
    // Implementation
  }
}
```

### 3. Minimize Inline Comments

**As a general principle, avoid inline comments in code.** Well-written code should be self-documenting through:
- Clear variable and function names
- Proper code structure
- Appropriate abstractions

```typescript
// ❌ Bad - Obvious comments
function processUserData(userData: UserData): ProcessedData {
  // Check if user data exists
  if (!userData) {
    // Return null if no data
    return null;
  }
  
  // Process the data
  return {
    id: userData.id,
    name: userData.name.trim(), // Trim whitespace
    email: userData.email.toLowerCase() // Convert to lowercase
  };
}

// ✅ Good - Self-documenting code
function processUserData(userData: UserData): ProcessedData {
  if (!userData) {
    return null;
  }
  
  return {
    id: userData.id,
    name: userData.name.trim(),
    email: userData.email.toLowerCase()
  };
}
```

## Acceptable Inline Comments

While we minimize inline comments, certain situations require them for clarity and maintainability:

### 1. Clarifying Non-Obvious Values

**Use comments to explain the meaning of numeric values, color codes, or other constants** that aren't immediately clear.

```typescript
// ✅ Good - Time calculations
const SESSION_TIMEOUT = 60 * 60 * 24; // 1 day in seconds
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

// ✅ Good - Color values
const THEME_COLORS = {
  primary: '#3B82F6',   // Blue
  secondary: '#6B7280', // Gray
  danger: '#EF4444',    // Red
  success: '#10B981'    // Green
};

// ✅ Good - Configuration values
const MAX_RETRY_ATTEMPTS = 3; // Based on network timeout studies
const BATCH_SIZE = 100;       // Optimal for database performance
```

### 2. Explanatory Comments for Complex Logic

**Add comments to explain non-obvious business logic, workarounds, or special implementations.**

```typescript
// ✅ Good - Explaining business logic
function calculateDiscount(user: User, order: Order): number {
  // VIP users get an additional 5% discount on top of regular promotions
  // This is a business requirement from the marketing team
  if (user.tier === 'VIP') {
    return order.discount + 0.05;
  }
  
  return order.discount;
}

// ✅ Good - Explaining workarounds
function parseApiResponse(response: string): ParsedData {
  // API returns malformed JSON with trailing commas
  // Remove them before parsing until API v2 is released
  const cleanedResponse = response.replace(/,(\s*[}\]])/g, '$1');
  
  return JSON.parse(cleanedResponse);
}

// ✅ Good - Explaining error handling
try {
  await riskyOperation();
} catch (error) {
  // Intentionally swallow this error as it's non-critical
  // The operation will be retried by the background job
  logger.debug('Non-critical operation failed', error);
}
```

### 3. Warning Comments

**Use comments to warn about potential issues, side effects, or important considerations.**

```typescript
// ✅ Good - Performance warnings
function processLargeDataset(data: DataItem[]): ProcessedItem[] {
  // WARNING: This operation is O(n²) and should not be used with datasets > 1000 items
  // Consider using the batch processing API for larger datasets
  return data.map(item => 
    data.filter(other => other.category === item.category)
  );
}

// ✅ Good - Side effect warnings
function updateUserPreferences(userId: string, preferences: Preferences): void {
  // NOTE: This function triggers a cache invalidation across all user sessions
  // Use sparingly to avoid performance impact
  userCache.invalidate(userId);
  database.updatePreferences(userId, preferences);
}
```

### 4. Lint Suppression Comments

**Tool-specific comments for disabling linting rules** are acceptable when justified.

```typescript
// ✅ Acceptable - Justified lint suppression
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function legacyApiCall(data: any): Promise<any> {
  // Legacy API doesn't provide proper types
  // TODO: Remove when migrating to v2 API
  return fetch('/legacy-api', { body: data });
}

// ✅ Acceptable - Disabling specific rules
/* eslint-disable no-console */
// Console logging is required for this debugging utility
function debugLog(message: string): void {
  console.log(`[DEBUG] ${new Date().toISOString()}: ${message}`);
}
/* eslint-enable no-console */
```

## Comment Quality Standards

### Be Concise and Clear

```typescript
// ❌ Bad - Verbose and obvious
// This function takes a user ID parameter and returns the corresponding user object from the database
function getUser(id: string): Promise<User> {
  return database.findUserById(id);
}

// ✅ Good - Concise and informative
/**
 * Retrieves user by ID from database
 */
function getUser(id: string): Promise<User> {
  return database.findUserById(id);
}
```

### Explain "Why", Not "What"

```typescript
// ❌ Bad - Explains what the code does
// Set timeout to 5000 milliseconds
const TIMEOUT = 5000;

// ✅ Good - Explains why this value was chosen
// Timeout chosen based on 95th percentile response time analysis
const TIMEOUT = 5000; // 5 seconds
```

### Keep Comments Up-to-Date

```typescript
// ❌ Bad - Outdated comment
/**
 * Validates email format using regex
 * @deprecated Use validateEmailWithAPI instead
 */
function validateEmail(email: string): boolean {
  // Still using regex validation, comment is outdated
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ✅ Good - Accurate comment
/**
 * Validates email format using regex pattern
 * For production use, consider validateEmailWithAPI for better accuracy
 */
function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
```

## Examples of Well-Commented Code

```typescript
/**
 * E-commerce order processing service
 * Handles order validation, payment processing, and inventory management
 */
export class OrderService {
  private readonly PAYMENT_TIMEOUT = 30 * 1000; // 30 seconds - industry standard
  
  /**
   * Processes a customer order
   * @param order - The order to process
   * @param paymentMethod - Customer's preferred payment method
   * @returns Processing result with order ID and status
   * @throws {PaymentError} When payment processing fails
   * @throws {InventoryError} When items are out of stock
   */
  async processOrder(order: Order, paymentMethod: PaymentMethod): Promise<OrderResult> {
    // Validate inventory before charging customer
    // This prevents charging for unavailable items
    await this.validateInventory(order.items);
    
    try {
      const payment = await this.processPayment(order.total, paymentMethod);
      return {
        orderId: payment.orderId,
        status: 'completed',
        tracking: this.generateTrackingNumber()
      };
    } catch (error) {
      // Release reserved inventory on payment failure
      // Prevents items being locked indefinitely
      await this.releaseInventoryReservation(order.items);
      throw error;
    }
  }
  
  private generateTrackingNumber(): string {
    // Format: YY-MM-DD-XXXXXX (date + 6 random digits)
    // Chosen for customer service ease of reference
    const date = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const random = Math.random().toString().slice(2, 8);
    return `${date}-${random}`;
  }
}
```

## Enforcement

These guidelines are enforced through:
- **Automated linting rules** that check for non-English comments
- **Code review process** that verifies TSDoc completeness
- **Documentation generation** that validates comment quality

Following these guidelines ensures our codebase remains maintainable, accessible, and professional for all team members and contributors.