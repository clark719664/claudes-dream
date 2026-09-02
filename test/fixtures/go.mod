module example.com/fixture/app

go 1.22

require github.com/spf13/cobra v1.8.0

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/sirupsen/logrus v1.9.3
	golang.org/x/text v0.14.0 // indirect
	github.com/sirupsen/logrs v1.9.0
	example.internal/corp/private v0.3.0
)

require example.internal/corp/tools v0.1.0

replace (
	github.com/gin-gonic/gin => github.com/gin-gonic/gin v1.9.0
	example.internal/corp/private => ../private
)

replace example.internal/corp/tools v0.1.0 => ./tools

exclude github.com/spf13/cobra v1.7.0
