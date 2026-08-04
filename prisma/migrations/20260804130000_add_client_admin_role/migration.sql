-- Adds a CLIENT_ADMIN role: same manage-users/company permissions as
-- CLIENT_OWNER, but a company can have more than one active admin (only
-- CLIENT_OWNER is constrained to "exactly one active" in app logic).
ALTER TYPE "Role" ADD VALUE 'CLIENT_ADMIN';
