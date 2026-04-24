module.exports = {
	preset: "ts-jest",
	testEnvironment: "jsdom",
	moduleNameMapper: {
		"^@/(.*)$": "<rootDir>/apps/web/src/$1",
		"^@utils/(.*)$": "<rootDir>/apps/web/src/utils/$1",
		"^@components/(.*)$": "<rootDir>/apps/web/src/components/$1",
	},
	testPathIgnorePatterns: ["/node_modules/", "/dist/"],
	transform: {
		"^.+\\.(ts|tsx)$": "ts-jest",
	},
	globals: {
		"ts-jest": {
			tsconfig: "apps/web/tsconfig.json",
		},
	},
};
