CXX      ?= g++
CXXFLAGS ?= -O2 -std=c++17

BINS = bin/els bin/els_parallel bin/tomita bin/chiba

all: $(BINS)

bin/els_parallel: src/els_parallel.cpp | bin
	$(CXX) $(CXXFLAGS) -fopenmp $< -o $@

bin/%: src/%.cpp | bin
	$(CXX) $(CXXFLAGS) $< -o $@

bin:
	mkdir -p bin

clean:
	rm -rf bin

.PHONY: all clean
