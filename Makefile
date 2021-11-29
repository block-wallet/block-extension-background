TS_NODE_PROJECT			 := ./tsconfig.json
TS_NODE_COMPILER_OPTIONS := $(shell echo {\"module\": \"commonjs\" })
BRANCH					 := $(shell git symbolic-ref --short -q HEAD | sed 's/[\.\/]/-/g')
TS_CONFIG_PATHS 		 := true
export

#test:
#	yarn nyc --reporter=text mocha './test' --require esm  --require isomorphic-fetch --require jsdom-global/register --require ts-node/register 'test/**/*.test.ts' --exit

test/background:
	yarn run postinstall
	yarn nyc -a --reporter=html --reporter=text mocha './test' --require esm --require isomorphic-fetch --require jsdom-global/register --require ts-node/register 'test/**/*.test.ts' --require tsconfig-paths/register --require './test/mocks/sinonChrome.js'  --timeout 10000 --exit

build/background:
	yarn run postinstall

	@if [ $(BRANCH) != "master" ]; then \
		npx webpack --config ./webpack/webpack.dev.js; \
	else \
		npx webpack --config ./webpack/webpack.config.js; \
	fi

depcheck:
	@npx depcheck
