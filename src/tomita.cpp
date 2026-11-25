// Tomita, Tanaka & Takahashi (2006): Bron-Kerbosch with max-degree pivoting.
// Build: make   Run: ./bin/tomita <graph.txt>
// Input: first line "n m", then m lines "u v" (0-based vertex ids).

#include <bits/stdc++.h>
// #include <omp.h>
#include <chrono>
using namespace std;
using namespace std::chrono; // for measuring execution times

vector<int> globalCliqueSizes;  // sizes of all maximal cliques 
long long globalTotalCliques = 0; // allows parallelization
int globalMaxCliqueSize = 0; // Largest clique size
map<int, int> sizeDist; // frequency distribution of clique sizes

// EXPAND: Choose a vertex 'u' from (CAND ∪ FINI) that maximizes the number of neighbors in CAND.
int EXPAND(const unordered_set<int>& CAND, const unordered_set<int>& FINI, const vector<unordered_set<int>>& SUBG) {
    int bestVertex = -1, bestCount = -1; // bestCount stores the maximum number of neighbors for a vertex  
    unordered_set<int> UNION = CAND; // UNION = CAND ∪ FINI
    UNION.insert(FINI.begin(), FINI.end());
    for (int u : UNION) {
        int count = 0;
        for (int w : CAND)
            if (SUBG[u].count(w))
                count++;
        if (count > bestCount) {
            bestCount = count;
            bestVertex = u;
        }
    }
    return bestVertex;
}

// CLIQUES: Recursive procedure to be implemented in the Tomita Paper.
void CLIQUES(vector<int>& clique, unordered_set<int>& CAND, unordered_set<int>& FINI, const vector<unordered_set<int>>& SUBG) {
    // if CAND and FINI are empty, clique is maximal
    if (CAND.empty() && FINI.empty()) {
        int size = clique.size();
        // #pragma omp critical 
        {
            globalCliqueSizes.push_back(size);
            globalTotalCliques++;
            sizeDist[size]++; // For the histogram, avoids another entire iteration over the clique sizes for histogram 
            globalMaxCliqueSize = max(globalMaxCliqueSize, size);
        }
        return;
    }
    // Choose pivot vertex 'u' from (CAND ∪ FINI) that maximizes the number of neighbors in CAND.
    int pivot = EXPAND(CAND, FINI, SUBG);
    // ext = CAND - N(u) (Difference Set)
    unordered_set<int> ext;
    for (int v : CAND) {
        if (!SUBG[pivot].count(v))
            ext.insert(v);
    }

    vector<int> extCopy(ext.begin(), ext.end());
    for (int v : extCopy) {
        clique.push_back(v);
        // Build new candidate set: CANDq = CAND ∩ N(v)
        unordered_set<int> CANDq;
        for (int w : CAND) {
            if (SUBG[v].count(w))
                CANDq.insert(w);
        }

        // Build new finished set: FINIq = FINI ∩ N(v)
        unordered_set<int> FINIq;
        for (int w : FINI) {
            if (SUBG[v].count(w))
                FINIq.insert(w);
        }

        // Recursion step with clique, CANDq, FINIq
        CLIQUES(clique, CANDq, FINIq, SUBG);

        // backtracking step for when adding a new vertex does not satisfy maximal property
        clique.pop_back();

        // remove 'v' from CAND
        CAND.erase(v);
        // add 'v' to FINI since the vertex has been EXPANDed
        FINI.insert(v);
    }
}

// main: Takes the input.txt file, loads the graph and performs CLIQUES for each vertex.
int main(int argc, char* argv[]){
    if(argc != 2){
        cerr << "Please input in the format : <executable_name> <dataset_filename>" << endl;
        return 1;
    }
    ifstream infile(argv[1]);
    if(!infile){
        cerr << "Error: Could not open file " << argv[1] << endl;
        return 1;
    }

    // start the execution time before loading the dataset into a graph
    auto start_time = high_resolution_clock::now();

    // number of vertices = n, number of edges = m (first two lines of the input file)
    int n, m;
    infile >> n >> m;
    vector<unordered_set<int>> graph(n); // stores the graph as an adjacency list
    int u, v; // u - start vertex, v - end vertex
    for (int i = 0; i < m; i++){
         infile >> u >> v;
         // Assume vertices are 0-based and 0 <= u,v < n.
         if(u < 0 || u >= n || v < 0 || v >= n) continue;
         if(u != v){
             // ensuring an undirected graph by entering both u->v and v->u
             graph[u].insert(v);
             graph[v].insert(u);
         }
    }
    infile.close();
    // Debug statement to check if the graph has been loaded correctly
    cout << "graph loaded with " << n << " nodes and " << m << " edges." << endl;

    // Parallelize the outer loop so that each vertex i is processed in parallel.
    // (OMP lines are commented since this version does not use OpenMP.)
    // #pragma omp parallel for schedule(dynamic)
    for (int i = 0; i < n; i++){
        unordered_set<int> CAND, FINI;
        // For vertex i, candidate set: all neighbors with index > i.
        for (int j = i + 1; j < n; j++){
            if(graph[i].count(j))
                CAND.insert(j);
        }
        // Finished set: all neighbors with index < i.
        for (int j = 0; j < i; j++){
            if(graph[i].count(j))
                FINI.insert(j);
        }
        vector<int> clique;
        clique.push_back(i);
        // recursively checks if the clique is maximal, if not, backtracks
        CLIQUES(clique, CAND, FINI, graph);
    }

    auto end_time = high_resolution_clock::now();

    // exec_time is measured in seconds
    double exec_time = duration_cast<milliseconds>(end_time - start_time).count()/1000.0;

    // Results
    cout << "\n------------Results--------------" << endl;
    cout << "Total maximal cliques: " << globalTotalCliques << endl;
    cout << "Largest maximal clique size: " << globalMaxCliqueSize << endl;
    cout << "Execution time: " << exec_time << " seconds" << endl;
    cout << "Distribution of maximal clique sizes:" << endl;
    for (auto &cli : sizeDist)
         cout << "  Size " << cli.first << ": " << cli.second << " maximal cliques. " << endl;
    return 0;
}
